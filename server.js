var smpp = require('smpp');
var rc = require('rc');
var ClientsManager = require('./clientmanager');
var Storage = require('./storage');
var Modem = require('gsm-modem');
var HttpApp = require('./HttpApp').HttpApp;
var httpApp = new HttpApp();



var argv = rc('smpp2modem', {
  http_port: 80,
  smpp_port: 2775,
  main_port: '/dev/ttyUSB0',
  db_file: 'smsc.sqlite',
  debug: false
});

var storage = new Storage(argv.db_file);
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
var opts = {
  port : argv.main_port,
  onSMS : onSMS,
  onStatusReport : clientsManager.handleDeliveryReport.bind(clientsManager),
  onDisconnect : onDisconnect,
  debug : argv.debug
};
if (argv.notify_port) {
    opts.notify_port = argv.notify_port;
}
if (argv.balance_ussd) {
  opts.balance_ussd = argv.balance_ussd;
  if (argv.dollar_regexp) {
    opts.dollar_regexp = new RegExp(argv.dollar_regexp);
  }
  if (argv.cents_regexp) {
    opts.cents_regexp = new RegExp(argv.cents_regexp);
  }
}
var modem = new Modem(opts);

modem.connect(function () {
  clientsManager.modem = modem;
  server.listen(argv.smpp_port);
  httpApp.start(argv.http_port, modem);
});
