var smpp = require('smpp');
var Q = require('q');
var rufus = require('rufus');

function ESME(session, storage, modemManager) {
  this.session = session;
  this.modemManager = modemManager;
  this.userId = -1;
  this.__defineGetter__('authorized', function () { return this.userId !== -1; });
  this.__defineGetter__('storage', function () { return storage; });

  // Client's authorization
  session.on('bind_transceiver', this.bindTransceiver.bind(this));

  session.on('submit_sm', this.submitSM.bind(this));

  session.on('enquire_link', function (pdu) {
    session.send(pdu.response());
  });

  session.on('unbind', function (pdu) {
    session.send(pdu.response());
    session.close();
  });
  this.sendSYSInterval = null;
}
/**
 * bind_transceiver handler
 */
ESME.prototype.bindTransceiver = function (pdu) {
  this.session.pause();
  this.checkUserPass(pdu.system_id, pdu.password).then(
    function () {
      this.session.send(pdu.response());
      this.session.resume();
      this.sendSYSInterval = setInterval(this.sendSYS.bind(this), 60000);
      this.sendSYS();
    }.bind(this),
    function (err) {
      console.error('Authorization with', pdu.system_id, pdu.password, 'failed', err);
      this.session.send(pdu.response({
        command_status: smpp.ESME_RBINDFAIL
      }));
      this.session.close();
    }.bind(this)
  );
};
/**
 * Asynchronous function for checking system's authorization
 */
ESME.prototype.checkUserPass = function (systemId, password) {
  var deferred = Q.defer();
  this.storage.getUserId(systemId, password).then(
    function (userId) {
      this.userId = userId;
      deferred.resolve();
    }.bind(this),
    function (err) {
      deferred.reject(err);
    }
  );
  return deferred.promise;
};
/**
 * Handler for submit-sm command
 */
ESME.prototype.submitSM = function (pdu) {
  if (!this.authorized) {
    this.session.send(pdu.response({
      command_status: smpp.ESME_RPROHIBITED
    }));
    return;
  }

  if (pdu.service_type === 'USSD') {
    if (!pdu.short_message) {
      this.session.send(pdu.response({
        command_status: smpp.ESME_RSUBMITFAIL
      }));
    } else {
      var rnd = Math.floor(Math.random() * (10000 - 1000) + 1000);
      this.session.send(pdu.response({
        message_id: this.createMessageId(rnd)
      }));
      this.modemManager.modem.getUSSD(pdu.short_message.message, function (err, data) {
        if (!err) {
          this.sendUSSDResponse(pdu.short_message.message, data);
        } else {
          this.sendUSSDResponse(pdu.short_message.message, 'Error getting USSD');
        }
      }.bind(this));
    }
    return;
  }

  if (!pdu.short_message || !pdu.short_message.message) {
    this.session.send(pdu.response({
      command_status: smpp.ESME_RSUBMITFAIL
    }));
  } else {
    var destination = pdu.destination_addr;
    var ton = pdu.dest_addr_ton;
    var messageText = pdu.short_message.message;
    var reportRequested = (pdu.registered_delivery & 1) === 1;
    this.modemManager.queueMessage({
      destination: destination,
      destination_type: ton === 1 ? '91' : '81',
      message: messageText,
      esme_id: this.userId,
      submit_ts: Math.floor(new Date().getTime() / 1000),
      report_requested: reportRequested ? 1 : 0,
    }).then(
      function (msgId) {
        //SMS inserted into database, send response to ESME
        this.session.send(pdu.response({
          message_id: this.createMessageId(msgId)
        }));
      }.bind(this)
    ).catch(
      function (err) {
        console.error('Unable to send SMS', pdu, err);
        this.session.send(pdu.response({
          command_status: smpp.ESME_RSUBMITFAIL
        }));
      }.bind(this)
    );
  }
};
/**
 * Send report that sending SMS failed
 */
ESME.prototype.sendFail = function (message) {
  this.handleDeliveryReport(message, {status: '99'});
};
/**
 * Pass delivery report to ESME
 */
ESME.prototype.handleDeliveryReport = function (message, report) {
  if (report.status[0] === '0') {
    status = this.REPORT_STATUSES.DELIVERED;
    textStatus = 'DELIVRD';
  } else if (report.status[0] === '2') {
    status = this.REPORT_STATUSES.ENROUTE;
    textStatus = 'ENROUTE';
  } else if (report.status[0] === '4') {
    status = this.REPORT_STATUSES.EXPIRED;
    textStatus = 'EXPIRED';
  } else if (report.status[0] === '9') {
    status = this.REPORT_STATUSES.MODEM;
    textStatus = 'REJECTD';
  } else {
    status = this.REPORT_STATUSES.UNKNOWN;
    textStatus = 'UNKNOWN';
  }
  
  var sm = [
    'id:' + this.createMessageId(message.id),
    'sub:001',
    'dvlrd:001',
    'submit date:' + this.makeSMPP_TS(message.submit_ts),
    'done date:' + this.makeSMPP_TS(message.delivered_ts),
    'stat:' + textStatus,
    'err:000',
    'text:'// + message.message.substr(0, 20)
  ];

  this.session.deliver_sm({
    schedule_delivery_time: 0,
    validity_period: 0,
    registered_delivery: 0,
    sm_default_msg_id: 0,
    esm_class: 0x4,
    source_addr: message.destination,
    source_addr_ton: parseInt(message.destination_type, 16) === 0x91 ? 1 : 0,
    source_addr_npi: 1,
    destination_addr: this.modemManager.IMSI,
    dest_addr_ton: 1,
    dest_addr_npi: 1,
    receipted_message_id: this.createMessageId(message.id),
    message_state: status,
    short_message: sm.join(' ')
  });
};
/**
 * Statuses for delivery reports
 */
ESME.prototype.REPORT_STATUSES = {
  ENROUTE : 1,
  DELIVERED : 2,
  EXPIRED : 3,
  UNKNOWN : 7,
  MODEM : 8
};
/**
 * Forms SMPP timestamp
 */
ESME.prototype.makeSMPP_TS = function (date) {
  var jsDate;
  if (date) {
    jsDate = new Date(date * 1000);
  } else {
    jsDate = new Date();
  }
  var str = '';
  str += jsDate.getFullYear().toString().substr(2, 2);
  str += ('0' + (jsDate.getMonth() + 1)).substr(-2, 2);
  str += ('0' + jsDate.getDate()).substr(-2, 2);
  str += ('0' + jsDate.getHours()).substr(-2, 2);
  str += ('0' + jsDate.getMinutes()).substr(-2, 2);
  str += ('0' + jsDate.getSeconds()).substr(-2, 2);
  str += jsDate.getMilliseconds().toString().substr(0, 1);
  var n = jsDate.getTimezoneOffset() / 15;
  str += ('00' + n).substr(-2, 2);
  str += n < 0 ? '+' : '-';
  return str;
};
/**
 * Returns true if ESME's session equals passed session
 */
ESME.prototype.sessionEquals = function (sess) {
  return (this.session === sess);
};
/**
 * Forms message id
 */
ESME.prototype.createMessageId = function (messageId) {
  return this.modemManager.IMSI + '_' + messageId;
};
/**
 * Passes incoming message to ESME
 */
ESME.prototype.passMessage = function (message) {
  this.session.deliver_sm({
    source_addr: message.sender,
    source_addr_ton: message.sender_type === '91' ? 1 : 0,
    source_addr_npi: 1,
    destination_addr: this.modemManager.IMSI,
    destination_addr_ton: 1,
    destination_addr_npi: 1,
    short_message: message.text,
    data_coding: message.dcs
  });
};
/**
 * Sends USSD response to ESME
 */
ESME.prototype.sendUSSDResponse = function (ussdNum, text) {
  this.session.deliver_sm({
    service_type: 'USSD',
    source_addr: ussdNum,
    source_addr_ton: 0,
    source_addr_npi: 1,
    destination_addr: this.modemManager.IMSI,
    destination_addr_ton: 1,
    destination_addr_npi: 1,
    short_message: text,
    data_coding: this.modemManager.modem.isGSMAlphabet(text) ? 0 : 8
  });
};

ESME.prototype.sendSYS = function () {
  this.modemManager.getSignal().then(
    function (info) {
      this.session.deliver_sm({
        service_type: 'SYS',
        source_addr: this.modemManager.IMSI,
        source_addr_ton: 0,
        source_addr_npi: 1,
        destination_addr: this.modemManager.IMSI,
        destination_addr_ton: 0,
        destination_addr_npi: 1,
        short_message: "Signal: " + info.db,
        data_coding: 0
      });
    }.bind(this)
  );
};

module.exports = ESME;
