var smpp = require('smpp');
var Q = require('q');


function ESME(session, storage, modem) {
    this.storage = storage;
    this.session = session;
    this.modem = modem;
    this.userId = -1;
    this.__defineGetter__('authorized', function () { return this.userId !== -1; });

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
 * 
 */
ESME.prototype.submitSM = function (pdu) {
    if (!this.authorized) {
        this.session.send(pdu.response({
            command_status: smpp.ESME_RPROHIBITED
        }));
        return;
    }
    if (!pdu.short_message || !pdu.short_message.message) {
        this.session.send(pdu.response({
            command_status: smpp.ESME_RSUBMITFAIL
        }));
    } else {
        var destination = pdu.destination_addr;
        var messageText = pdu.short_message.message;
        this.storage.addOutboxSMS(this.userId, destination, messageText).then(
            function (msgId) {
                this.modem.sendSMS({
                    receiver : destination,
                    text : messageText,
                    request_status : pdu.registered_delivery === 1
                }, function (err, data) {
                    if (undefined === err) {
                        this.storage.setOutboxReferences(msgId, data).then(
                            function () {
                                //SMS sent
                                this.session.send(pdu.response({
                                    message_id: msgId+''
                                }));
                            }.bind(this),
                            function (err) {
                                console.error('Unable to update message', msgId, 'in the storage with given reference id', data, err);
                                this.session.send(pdu.response({
                                    command_status: smpp.ESME_RSUBMITFAIL
                                }));
                            }.bind(this)
                        );
                    } else {
                        console.error('Unable to send message', msgId, 'over modem', err);
                        this.session.send(pdu.response({
                            command_status: smpp.ESME_RSUBMITFAIL
                        }));
                    }
                }.bind(this));
            }.bind(this),
            function (err) {
                console.error('Unable to insert SMS into the storage', pdu, err);
                this.session.send(pdu.response({
                    command_status: smpp.ESME_RSUBMITFAIL
                }));
            }.bind(this)
        );
    }
};

ESME.prototype.handleDeliveryReport = function (message, report, deliveredCount) {
    var sm = [
        'id:' + message.id,
        'sub:001',
        'dvlrd:001',
        'submit date:' + this.makeSMPP_TS(message.submit_ts),
        'done date:' + this.makeSMPP_TS(message.delivered_ts),
        'stat:DELIVRD',
        'err:000',
        'text:' + message.message.substr(0, 20)
    ];

    this.session.deliver_sm({
        schedule_delivery_time: 0,
        validity_period: 0,
        registered_delivery: 0,
        sm_default_msg_id: 0,
        esm_class: 0x4,
        source_addr: message.destination,
        source_addr_ton: 91,
        receipted_message_id: message.id.toString(),
        message_state: report.status,
        short_message: sm.join(' ')
    });
};

ESME.prototype.makeSMPP_TS = function (date) {
    var jsDate = new Date(date * 1000);
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

ESME.prototype.sessionEquals = function (sess) {
    return (this.session === sess);
};

module.exports = ESME;