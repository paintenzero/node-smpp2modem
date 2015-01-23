var Modem = require('gsm-modem');
var Q = require('q');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SendQueue = require('./send-queue').SendQueue;
var rufus = require('rufus');

function ModemManager(opts, storage) {
  // Call the super constructor.
  EventEmitter.call(this);

  opts.commandsTimeout = 15000;
  this.__defineGetter__('storage', function () { return storage; });
  this.__defineGetter__('IMSI', function () { return this.modemInfo ? this.modemInfo.imsi : ''; }.bind(this));
  this.__defineGetter__('opts', function () { return opts; });
  this.sendQueue = new SendQueue(this, this.storage, opts);
  this.reconnecting = false;

  this.createModem();
  this.logger = rufus.getLogger();
  this.reconnecting = false;

  return this;
}
util.inherits(ModemManager, EventEmitter);

ModemManager.prototype.createModem = function () {
  this.modem = new Modem(this.opts);
  this.modem.on('message', this.onSMS.bind(this));
  this.modem.on('report', this.onStatusReport.bind(this));
  this.modem.on('disconnect', this.onDisconnect.bind(this));
  this.modem.on('error', this.onError.bind(this));
};

ModemManager.prototype.start = function () {
  var deferred = Q.defer();


  this.modem.connect(function (err) {
    if (err) {
      deferred.reject(err);
      return;
    }
    this.identify().then(
      function (info) {
        this.modemInfo = info;
        this.storage.setIMSI(this.IMSI);
        return this.getAndDeleteMessages('SM'); //Get messages from SIM-card
      }.bind(this),
      function (err) {
        deferred.reject(err);
      }
    ).then(
      this.getAndDeleteMessages.bind(this, 'ME'),
      function (err) {
        deferred.reject(err);
      }
    ).then(
      function () {
        var done = function () {
          this.sendQueue.checkOutbox();
          deferred.resolve();
        }.bind(this);
        if (this.modem.manufacturer.indexOf('ZTE') !== -1) {
          this.modem.readDeleteZTE_SR(function (err, messages) {
            if (messages && messages.length > 0) {
              this.parseMessages(messages);
            }
            done();
          }.bind(this));
        } else {
          done();
        }
      }.bind(this),
      function (err) {
        deferred.reject(err);
      }
    );
  }.bind(this));

  return deferred.promise;
};

ModemManager.prototype.getAndDeleteMessages = function (storage) {
  var deferred = Q.defer();
  Q.ninvoke(this.modem, "getMessagesFromStorage", storage).then(
    this.parseMessages.bind(this),
    function (err) {
      Q.ninvoke(this.modem, "deleteAllSMS").then(
        function () {
          deferred.resolve();
        },
        function (err) {
          deferred.reject(err);
        }
      );
    }.bind(this)
  ).then(
    function () {
      return Q.ninvoke(this.modem, "deleteAllSMS");
    }.bind(this),
    function (err) {
      deferred.reject(err);
    }
  ).then(
    function () {
      deferred.resolve();
    },
    function (err) {
      deferred.reject(err);
    }
  );
  return deferred.promise;
};
/**
 * Reconnects the modem
 */
ModemManager.prototype.reconnect = function () {
  if (this.reconnecting) {
    return;
  }
  this.reconnecting = true;
  console.log('Try to reconnect');
  this.modem.close(function () {
    console.log('Connecting to the modem again');
    setTimeout(function () {
      this.start().then(
        function () {
          console.log('Reconnected!');
          this.reconnecting = false;
        }.bind(this),
        function (err) {
          console.log('Reconnect error: %s', err.message);
          this.emit('error', err);
        }.bind(this)
      );
    }.bind(this), 15000);
  }.bind(this));
};
/**
 * Callback for modem message receive
 */
ModemManager.prototype.onSMS = function (message) {
  this.storage.addInboxMessage(message, message.smsc_tpdu);
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
          this.storage.setMessageStatus(message, report);
          this.emit('status_report', message, report);
        } else {
          this.storage.getPartsWithStatus(message.id, message.destination).then(
            function (cnt) {
              if (message.parts <= cnt) {
                this.storage.setMessageStatus(message, report);
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
ModemManager.prototype.onDisconnect = function () {
  if (!this.reconnecting) {
    this.logger.debug('port was closed!');
    this.reconnect();
  }
};
/**
 * Callback for modem error
 */
ModemManager.prototype.onError = function (err) {
  if (err.message === 'TIMEOUT') {
    this.reconnect();
  } else {
    this.logger.debug('Modem manager emitting error: %s', err.message);
    this.emit('error', err);
  }
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
      },
      function (err) {
        deferred.reject(err);
      }
    ).then(
      function (imei) {
        ret.imei = imei;
        return Q.ninvoke(modem, 'getIMSI');
      },
      function (err) {
        deferred.reject(err);
      }
    ).then(
      function (imsi) {
        ret.imsi = imsi;
        deferred.resolve(ret);
      },
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
    if (messages.hasOwnProperty(k)) {
      if (messages[k].tpdu_type === 'SMS-STATUS-REPORT') {
        this.onStatusReport(messages[k]);
      } else if (messages[k].tpdu_type === 'SMS-DELIVER') {
        promises.push(this.storage.addInboxMessage(messages[k], messages[k].smsc_tpdu));
      }
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
/**
 *
 */
ModemManager.prototype.getSignal = function () {
  return Q.ninvoke(this.modem, "getSignalStrength");
};

module.exports.ModemManager = ModemManager;
