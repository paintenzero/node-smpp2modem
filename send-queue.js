var Q = require('q');

function SendQueue(modemManager, storage, options) {
  this.__defineGetter__('modem', function () { return modemManager.modem; });
  this.__defineGetter__('modemManager', function () { return modemManager; });
  this.__defineGetter__('storage', function () { return storage; });
  this.__defineGetter__('failureTimeout', function () { return options.failure_timeout || 5000; });
  this.__defineGetter__('maxFailures', function () { return options.max_failures || 3; });

  this.queue = [];
}

SendQueue.prototype.checkOutbox = function(first_argument) {
  this.storage.getOutboxMessages().then(
    function (results) {
      if (results.length > 0) {
        var i = 0;
        for (i; i < results.length; ++i) {
          this.queue.push(results[i]);
        }
        this.sendNext();
      }
    }.bind(this),
    function (err) {
      console.error(err);
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
      if (this.queue.length === 1) {
        this.sendNext();
      }
    }.bind(this),
    function (err) {
      deferred.reject(err);
    }
  );

  return deferred.promise;
};

SendQueue.prototype.sendNext = function () {
  if (this.queue.length > 0) {
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
        this.queue.splice(0, 1);
        this.sendNext();
      }.bind(this)
    ).catch(
      function (err) {
        console.error('Error sending message', err);
        if (!this.queue[0].failures) {
          this.queue[0].failures = 1;
        } else {
          ++this.queue[0].failures;
        }
        if (message.failures >= this.maxFailures) {
          this.queue.splice(0, 1);
          Q.nextTick(this.sendNext.bind(this));
          this.modemManager.emit('send_fail', message);
          this.storage.giveUpSendingMessage(message, err).fail(
            function (err) {
              console.error('Failure while giving up ', err);
            }
          );
        } else {
          setTimeout(this.sendNext.bind(this), 2000);
          this.storage.markFailure(message).fail(
            function (err) {
              console.error('Mark failure error', err);
            }
          );
        }

        //TODO: mark failure...
      }.bind(this)
    );
  }
};

module.exports.SendQueue = SendQueue;