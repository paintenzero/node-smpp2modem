var ESME = require('./esme');

function ClientsManager(storage, modemManager) {
  this.clients = [];

  this.__defineGetter__('storage', function () { return storage; });
  this.__defineGetter__('modemManager', function () { return modemManager; });
  modemManager.on('message', this.handleIncomingMessage.bind(this));
  modemManager.on('send_fail', this.handleSendFailure.bind(this));
  modemManager.on('status_report', this.handleReport.bind(this));
}

ClientsManager.prototype.addClientSession = function (sess) {
  var client = new ESME(sess, this.storage, this.modemManager);
  this.clients.push(client);

  sess.on('close', function () {
    this.deleteClientBySession(sess);
  }.bind(this));
};

ClientsManager.prototype.deleteClientBySession = function (sess) {
  var i;
  for (i = 0; i < this.clients.length; ++i) {
    if (this.clients[i].sessionEquals(sess)) {
      this.clients.splice(i, 1);
      return;
    }
  }
};

ClientsManager.prototype.getClientByID = function (clientId) {
  var i = 0;
  for (i; i < this.clients.length; ++i) {
    if (this.clients[i].userId === clientId) {
      return this.clients[i];
    }
  }
  return null;
};

ClientsManager.prototype.handleIncomingMessage = function (message) {
  this.clients.forEach(function (client) {
    client.passMessage(message);
  });
};

ClientsManager.prototype.handleSendFailure = function(message) {
  this.clients.forEach(function (client) {
    client.sendFail(message);
  });
};

ClientsManager.prototype.handleReport = function(message, report) {
  this.clients.forEach(function (client) {
    client.handleDeliveryReport(message, report.status);
  });
};

/*ClientsManager.prototype.handleDeliveryReport = function (modem, report) {
    var aMessage;
    modem.deleteAllSMS();
    this.storage.setReferenceDelivered(report.reference, parseInt(report.status, 10)).then(
        function () {
            return this.storage.getMessageForReference(report.reference);
        }.bind(this)
    ).then(
        function (message) {
            aMessage = message;
            return this.storage.getDeliveredParts(message.id);
        }.bind(this)
    ).then(
        function (deliveredCount) {
            if (deliveredCount === aMessage.parts) {
                this.storage.setMessageDelivered(aMessage.id).then(
                    function () {
                        aMessage.delivered_ts = Math.floor((new Date()).getTime() / 1000);
                        var esme = this.getClientByID(aMessage.esme_id);
                        if (esme !== null) {
                            esme.handleDeliveryReport(aMessage, report, deliveredCount);
                        }
                    }.bind(this),
                    function (err) {
                        console.log(err);
                    }
                );
            }
        }.bind(this)
    );
};*/

module.exports = ClientsManager;