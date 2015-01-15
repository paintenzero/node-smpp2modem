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
    client.handleDeliveryReport(message, report);
  });
};

module.exports = ClientsManager;