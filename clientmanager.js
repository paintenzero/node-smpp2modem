var ESME = require('./esme');

function ClientsManager(storage) {
    this.clients = [];
    this.storage = storage;
    var modem = null;
    this.__defineGetter__('modem', function () { return modem; });
    this.__defineSetter__('modem', function (val) { modem = val; });
}

ClientsManager.prototype.addClientSession = function (sess) {
    var client = new ESME(sess, this.storage, this.modem);
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

ClientsManager.prototype.handleDeliveryReport = function (modem, report) {
    var aMessage;
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
};

module.exports = ClientsManager;