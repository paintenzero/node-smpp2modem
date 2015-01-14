var smpp = require('smpp');
var rc = require('rc');
var ClientsManager = require('./client-manager');
var Storage = require('./storage');
var ModemManager = require('./modem-manager').ModemManager;



var argv = rc('smpp2modem', {
  http_port: 80,
  smpp_port: 2775,
  main_port: '/dev/ttyUSB0',
  db_file: 'smsc.sqlite',
  debug: false,
  phone_number: '000'
});

var storage = new Storage(argv.db_file);

// Populate options for modem
var opts = {
  port: argv.main_port,
  debug: argv.debug,
  phone_number: argv.phone_number
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
if (argv.send_failure_timeout) {
  opts.failure_timeout = argv.send_failure_timeout;
}
if (argv.max_send_failures) {
  opts.max_failures = argv.max_send_failures;
}
// Create modem Manager
var modemMan = new ModemManager(opts, storage);

modemMan.start().then(
  function () {
    var clientsManager = new ClientsManager(storage, modemMan);
    var server = smpp.createServer(function (session) {
      clientsManager.addClientSession(session);
    });
    server.listen(argv.smpp_port, function () {
      console.log('Server started at %d', argv.smpp_port);
    });
  },
  function (err) {
    console.error('Unable to init modem', err);
  }
);