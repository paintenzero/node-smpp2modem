var smpp = require('smpp');
var rc = require('rc');
var ClientsManager = require('./client-manager');
var Storage = require('./storage');
var ModemManager = require('./modem-manager').ModemManager;



var argv = rc('smpp2modem', {
  smpp: 2775,
  modem: '/dev/ttyUSB0,/dev/ttyUSB1,/dev/ttyUSB2',
  sqlite: 'smsc.sqlite',
  debug: false
}, require('optimist')
  .alias('m', 'modem').describe('modem', 'Modem serial ports separated by comma')
  .describe('sqlite', 'SQLite database to use')
  .alias('s', 'smpp').describe('smpp', 'SMPP port to use')
  .alias('d', 'debug').describe('debug', 'Show debug')
  .argv);


function terminate() {
  process.exit();
}

var storage = new Storage(argv.sqlite);

// Populate options for modem
var opts = {
  ports: argv.modem.split(','),
  debug: argv.debug,
  phone_number: argv.phone_number,
  auto_hangup: argv.auto_hangup || false
};
if (argv.notify_port) {
  opts.notify_port = argv.notify_port;
}
if (argv.send_failure_timeout) {
  opts.failure_timeout = argv.send_failure_timeout;
}
if (argv.max_send_failures) {
  opts.max_failures = argv.max_send_failures;
}
// Create modem Manager
var modemMan = new ModemManager(opts, storage);
modemMan.on('error', function () {
  terminate();
});
modemMan.on('disconnect', function () {
  console.error('Modem disconnected!!!');
  terminate();
});

modemMan.start().then(
  function () {
    var clientsManager = new ClientsManager(storage, modemMan);
    var server = smpp.createServer(function (session) {
      clientsManager.addClientSession(session);
    });
    server.listen(argv.smpp, function () {
      console.log('Server started at %d', argv.smpp);
    });
  },
  function (err) {
    console.error('Unable to init modem', err);
    terminate();
  }
);