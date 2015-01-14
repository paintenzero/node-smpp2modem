var Modem = require('gsm-modem');
var Q = require('q');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SendQueue = require('./send-queue').SendQueue;

function ModemManager(opts, storage) {
  // Call the super constructor.
  EventEmitter.call(this);

  opts.onDisconnect = this.onDisconnect.bind(this);

  this.options = {};

  var phoneNumber = opts.phone_number;
  delete opts.phone_number;

  var modem = new Modem(opts);
  modem.on('message', this.onSMS.bind(this));
  modem.on('report', this.onStatusReport.bind(this));


  this.__defineGetter__('modem', function () { return modem; });
  this.__defineGetter__('storage', function () { return storage; });
  this.__defineGetter__('IMSI', function () { return this.modemInfo ? this.modemInfo.imsi : ''; }.bind(this));
  this.__defineGetter__('phoneNumber', function () { return phoneNumber; });
  this.sendQueue = new SendQueue(this, this.storage, opts);

  return this;
}
util.inherits(ModemManager, EventEmitter);

ModemManager.prototype.start = function () {
  var deferred = Q.defer();
  this.modem.connect(function () {
    this.identify().then(
      function (info) {
        this.modemInfo = info;
        return Q.ninvoke(this.modem, "getAllSMS");
      }.bind(this)
    ).then(
      this.parseMessages.bind(this)
    ).then(
      function () {
        return Q.ninvoke(this.modem, "deleteAllSMS");
      }.bind(this)
    ).then(
      function () {
        this.sendQueue.checkOutbox();
        deferred.resolve();
      }.bind(this)
    ).catch(
      function (err) {
        deferred.reject(err);
      }.bind(this)
    );
  }.bind(this));

  return deferred.promise;
};
/**
 * Callback for modem message receive
 */
ModemManager.prototype.onSMS = function (message) {
  this.storage.addInboxMessage(message);
  this.emit('message', message);
};
/**
 * Callback for modem status report receive
 */
ModemManager.prototype.onStatusReport = function (report) {
  this.storage.setReferenceStatus(report.reference, report.sender, report.status).then(
    function () {
      return this.storage.getMessageForReference(report.reference, report.sender);
    }.bind(this),
    function (err) {
      console.error(err.message);
    }
  ).then(
    function (message) {
      if (message.report_requested === 1) {
        if (message.parts === 1) {
          this.emit('status_report', message, report);
        } else {
          this.storage.getPartsWithStatus(message.id, message.destination).then(
            function (cnt) {
              if (message.parts <= cnt) {
                this.emit('status_report', message, report);
              }
            }.bind(this),
            function (err) {
              console.error('Error while getting parts with statuses:', err.message);
            }
          );
        }
      }
    }.bind(this),
    function (err) {
      console.error(err.message);
    }
  );
};
/**
 * Callback for modem disconnect
 */
ModemManager.prototype.onDisconnect = function (modem) {
  console.err('Modem disconnected!!!');

};
/**
 * Gets modem's info
 */
ModemManager.prototype.identify = function () {
  var deferred = Q.defer();
  var ret = {};
  if (this.modemInfo !== undefined) {
    deferred.resolve(this.modemInfo);
  } else {
    var modem = this.modem;
    Q.ninvoke(this.modem, 'getModel').then(
      function (model) {
        ret.model = model;
        return Q.ninvoke(modem, 'getIMEI');
      }
    ).then(
      function (imei) {
        ret.imei = imei;
        return Q.ninvoke(modem, 'getIMSI');
      }
    ).then(
      function (imsi) {
        ret.imsi = imsi;
        deferred.resolve(ret);
      }
    ).catch(
      function (err) {
        deferred.reject(err);
      }
    );
  }
  return deferred.promise;
};
/**
 * Parses messages sent to modem
 */
ModemManager.prototype.parseMessages = function (messages) {
  var promises = [], k;
  for (k in messages) {
    if (messages[k].tpdu_type === 'SMS-STATUS-REPORT') {
      this.onStatusReport(messages[k]);
    } else if (messages[k].tpdu_type === 'SMS-DELIVER') {
      promises.push(this.storage.addInboxMessage(messages[k]));
    }
  }
  return Q.all(promises);
};

/**
 *
 */
ModemManager.prototype.queueMessage = function (message) {
  return this.sendQueue.add(message);
};

module.exports.ModemManager = ModemManager;