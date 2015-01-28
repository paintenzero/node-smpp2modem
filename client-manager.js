var ESME = require('./esme');
var Q = require('q');
var util = require('util');

function ClientsManager(storage, modemManager) {
  this.clients = [];

  this.__defineGetter__('storage', function () { return storage; });
  this.__defineGetter__('modemManager', function () { return modemManager; });
  modemManager.on('message', this.handleIncomingMessage.bind(this));
  modemManager.on('send_fail', this.handleSendFailure.bind(this));
  modemManager.on('status_report', this.handleReport.bind(this));
  modemManager.on('stat', this.handleStat.bind(this));

  this.sysInterval = setInterval(this.sendSYS.bind(this), 10000);
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
      this.clients[i].disconnect();
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
/**
 * Sends statistics to all connected EMSEs
 */
ClientsManager.prototype.handleStat = function(stat) {
  this.clients.forEach(function (client) {
    client.sendStat(stat);
  });
};
/**
 *
 */
ClientsManager.prototype.sendSYS = function () {
  var promises = [];
  promises.push(this.modemManager.getSignal());
  promises.push(this.storage.getOutboxLength());
  Q.all(promises).then(
    function (results) {
      var str = util.format("Signal: %d Queue: %d", results[0].db, results[1].cnt);
      this.clients.forEach(function (client) {
        client.sendSYS(str);
      });
    }.bind(this)
  );
};

module.exports = ClientsManager;
