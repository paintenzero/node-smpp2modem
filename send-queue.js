var Q = require('q');
var rufus = require('rufus');

var logger = rufus.getLogger();

function SendQueue(modemManager, storage, options) {
  this.__defineGetter__('modem', function () { return modemManager.modem; });
  this.__defineGetter__('modemManager', function () { return modemManager; });
  this.__defineGetter__('storage', function () { return storage; });
  this.__defineGetter__('failureTimeout', function () { return options.failure_timeout || 5000; });
  this.__defineGetter__('maxFailures', function () { return options.max_failures || 3; });
  this.__defineGetter__('sendInterval', function () { return options.send_interval || 10000; });

  this.queue = [];
  this.lastFailure = 0;
  this.failures = 0;

  this.sendInterval__ = setInterval(this.sendNext.bind(this), this.sendInterval);
}

SendQueue.prototype.checkOutbox = function () {
  this.storage.getOutboxMessages().then(
    function (results) {
      logger.info('Outbox has %d messages', results.length);
      if (results.length > 0) {
        var i = 0;
        for (i; i < results.length; ++i) {
          this.queue.push(results[i]);
        }
      }
    }.bind(this),
    function (err) {
      logger.error('Error getting outbox messages: %s', err.message);
    }
  );
};

SendQueue.prototype.add = function (message) {
  var deferred = Q.defer();

  this.storage.addOutboxSMS(message).then(
    function (id) {
      message.id = id;
      deferred.resolve(id);
      this.queue.push(message);
    }.bind(this),
    function (err) {
      deferred.reject(err);
    }
  );

  return deferred.promise;
};

SendQueue.prototype.sendNext = function () {
  if (this.queue.length === 0) {
    this.checkOutbox();
    return;
  }

  if (this.modemManager.reconnecting) {
    logger.error('Do not send SMS because modem manager is in reconnecting state');
    return;
  }

  var message = this.queue.slice(0, 1);
  message = message[0];
  Q.ninvoke(this.modem, "sendSMS", {
    receiver: message.destination,
    receiver_type: parseInt(message.destination_type, 16),
    text: message.message,
    request_status: true
  }).then(
    function (references) {
      this.storage.setMessageSent(message, references);
      this.failures = 0;
      this.queue.splice(0, 1);
    }.bind(this)
  ).catch(
    function (err) {
      logger.error('Error sending message %s', err.message);
      if (!this.queue[0].failures) {
        this.queue[0].failures = 1;
      } else {
        ++this.queue[0].failures;
      }
      if (parseInt(message.destination_type, 16) === 0x81 || message.failures >= this.maxFailures) {
        this.queue.splice(0, 1);
        this.modemManager.emit('send_fail', message);
        logger.debug('Giving up sending message');
        this.storage.giveUpSendingMessage(message, err.message).fail(
          function (err) {
            logger.error('Failure while giving up ', err);
          }
        );

        this.addFailure();
      } else {
        logger.debug('Will retry sending message later');
        this.storage.markFailure(message).fail(
          function (err) {
            logger.error('Mark failure error', err);
          }
        );
      }
    }.bind(this)
  );
};
/**
 * Adds failure to failure count
 */
SendQueue.prototype.addFailure = function () {
  if ((new Date()).getTime() - this.lastFailure > 1800000) {
    this.failures = 0;
  }
  this.lastFailure = (new Date()).getTime();
  ++this.failures;

  if (this.failures >= 3) {
    this.failures = 0;
    this.modemManager.reconnect();
  }
};

module.exports.SendQueue = SendQueue;
