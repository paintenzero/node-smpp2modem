var smpp = require('smpp');
var rc = require('rc');
var ClientsManager = require('./client-manager');
var Storage = require('./storage');
var ModemManager = require('./modem-manager').ModemManager;
var path = require('path');
var fs = require('fs');
var rufus = require('rufus');

var logger = rufus.getLogger();

var argv = rc('smpp2modem', {
  smpp: 2775,
  modem: '/dev/ttyUSB0,/dev/ttyUSB1',
  sqlite: 'smsc.sqlite',
  debug: false
}, require('optimist')
  .alias('m', 'modem').describe('modem', 'Modem serial ports separated by comma')
  .describe('sqlite', 'SQLite database to use')
  .alias('s', 'smpp').describe('smpp', 'SMPP port to use')
  .alias('d', 'debug').describe('debug', 'Show debug')
  .alias('p', 'pid').describe('pid', 'folder to create pid file').default('p', './pids')
  .argv);

if (!argv.debug) {
  logger.setLevel(rufus.ERROR);
} else {
  logger.setLevel(rufus.VERBOSE);
}

var portsArr = argv.modem.split(','), i;
function terminate() {
  logger.debug('Cleaning up');
  try {
    var portNameFile;
    for (i = 0; i < portsArr.length; ++i) {
      portNameFile = argv.pid + path.sep + portName + '.pid';
      if (fs.existsSync(portNameFile)) {
        fs.unlinkSync(portNameFile);
      }
    }
  } catch (err) {
    logger.error('Error cleaning up: %s', err.message);
  }
  var smppPortFile;
  try {
    smppPortFile = argv.pid + path.sep + process.pid + '.port';
    if (fs.existsSync(smppPortFile)) {
      fs.unlinkSync(smppPortFile);
    }
  } catch (err) {
    logger.error('Error cleaning up: %s', err.message);
  }
  logger.info('Terminating');
  process.exit();
}

logger.debug('Creating lock files');
if (!fs.existsSync(argv.pid)) {
  fs.mkdirSync(argv.pid);
}
var portName;
for (i = 0; i < portsArr.length; ++i) {
  portName = path.basename(portsArr[i]);
  fs.writeFileSync(argv.pid + path.sep + portName + '.pid', process.pid, {flag: 'w', mode: '0644'});
}
// Write SMPP port to file with process pid
fs.writeFileSync(argv.pid + path.sep + process.pid + '.port', argv.smpp, {flag: 'w', mode: '0644'});

logger.debug('Opening database file');
var storage = new Storage(argv.sqlite);
logger.debug('Database opened');

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
logger.debug('Creating modem manager');
var modemMan = new ModemManager(opts, storage);
modemMan.on('error', function () {
  terminate();
});
modemMan.on('disconnect', function () {
  logger.error('Modem disconnected!!!');
  terminate();
});
logger.debug('Starting modem manager');
modemMan.start().then(
  function () {
    logger.debug('Modem manager started');
    var clientsManager = new ClientsManager(storage, modemMan);
    var server = smpp.createServer(function (session) {
      clientsManager.addClientSession(session);
    });
    server.listen(argv.smpp, function () {
      logger.info('Server started at %d', argv.smpp);
    });
  },
  function (err) {
    logger.error('Unable to init modem', err);
    terminate();
  }
);

process.on('SIGINT', function () {
  logger.info('Caught SIGINT. Terminating');
  terminate();
});
