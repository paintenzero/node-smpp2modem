var smpp = require('smpp');
var ClientsManager = require('./clientmanager');
var Storage = require('./storage');
var Modem = require('gsm-modem');
var HttpApp = require('./HttpApp').HttpApp;
var httpApp = new HttpApp();

var storage = new Storage('smsc.sqlite');
var clientsManager = new ClientsManager(storage);

var server = smpp.createServer(function (session) {
    clientsManager.addClientSession(session);
});



function onSMS(modem, sms) {
    console.log('onSMS', sms);
}
function onDisconnect(modem) {
    console.log('onDisconnect');
}
var modem = new Modem({
    port : '/dev/ttyUSB0',
    notify_port : '/dev/ttyUSB1',
    onSMS : onSMS,
    onStatusReport : clientsManager.handleDeliveryReport.bind(clientsManager),
    onDisconnect : onDisconnect,
    balance_ussd : '*102*1#',
    dollar_regexp : /(-?\d+)\s*rub/,
    cents_regexp : /(-?\d+)\s*kop/,
    debug : true
});

modem.connect(function () {
    clientsManager.modem = modem;
    server.listen(2775);
    httpApp.start(80, modem);
});
