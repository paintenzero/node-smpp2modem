var smpp = require('smpp');
var rc = require('rc');
var ClientsManager = require('./client-manager');
var Storage = require('./storage');
var ModemManager = require('./modem-manager').ModemManager;
var path = require('path');
var fs = require('fs');


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
  .alias('p', 'pid').describe('pid', 'folder to create pid file').default('p', './pids')
  .argv);

var portsArr = argv.modem.split(','), i;
function terminate() {
  for (i=0; i < portsArr.length; ++i) {
    var portNameFile = argv.pid + path.sep + portName + '.pid';
    if (fs.existsSync(portNameFile)) {
      fs.unlinkSync(portNameFile);
    }
  }
  var smppPortFile = argv.pid + path.sep + argv.smpp + '.pid'
  if (fs.existsSync(smppPortFile)) {
      fs.unlinkSync(smppPortFile);
    }
  process.exit();
}

if (!fs.existsSync(argv.pid)) {
  fs.mkdirSync(argv.pid);
}
for (i=0; i < portsArr.length; ++i) {
  var portName = path.basename(portsArr[i]);
  fs.writeFileSync(argv.pid + path.sep + portName + '.pid', process.pid, {flag: 'w', mode: '0644'});
}
// Write SMPP port to file with process pid
fs.writeFileSync(argv.pid + path.sep + process.pid + '.port', argv.smpp, {flag: 'w', mode: '0644'});


var storage = new Storage(argv.sqlite);

// Populate options for modem
var opts = {
  ports: portsArr,
  debug: argv.debug,
  phone_number: argv.phone_number,
  auto_hangup: argv.auto_hangup || false
};
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

process.on('SIGINT', function () {
  console.log('Caught SIGINT. Terminating');
  terminate();
});