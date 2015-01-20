#!/usr/bin/env node
var fs          = require('fs-extra');
var path        = require('path');
var Q           = require('q');
var rufus       = require('rufus');
var spawn       = require('child_process').spawn;
var Modem       = require('gsm-modem');
var is_running  = require('is-running');

rufus.setLevel(rufus.INFO);
var SMPP_PORT_RANGE = [2775, 2779];
// Paths
var SERIALS_DIR = '/sys/bus/usb-serial/devices/';
var SERVER_PATH = './server.js';
var LOGS_DIR = __dirname + path.sep + 'logs';
var ORIG_DATABASE = __dirname + path.sep + 'smsc.sqlite';
var DB_DIR = __dirname + path.sep + 'db';
var PID_DIR = __dirname + path.sep + 'pids';

// Normalize paths
if (LOGS_DIR[0] !== '/') { LOGS_DIR = path.normalize(__dirname + path.sep + LOGS_DIR); }
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR);
}
if (DB_DIR[0] !== '/') { DB_DIR = path.normalize(__dirname + path.sep + DB_DIR); }
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}
if (PID_DIR[0] !== '/') { PID_DIR = path.normalize(__dirname + path.sep + PID_DIR); }
if (!fs.existsSync(PID_DIR)) {
  fs.mkdirSync(PID_DIR);
}
if (SERVER_PATH[0] !== '/') { SERVER_PATH = path.normalize(__dirname + path.sep + SERVER_PATH); }
if (ORIG_DATABASE[0] !== '/') { ORIG_DATABASE = path.normalize(__dirname + path.sep + ORIG_DATABASE); }

var tmpSMPPPorts = {};
/**
 * Returns first available SMPP port
 */
function GetFreeSMPPPort() {
  var busyPorts = {}, k;
  for (k in tmpSMPPPorts) {
    busyPorts[k] = 1;
  }

  var files = fs.readdirSync(PID_DIR), i;
  for (i = files.length - 1; i >= 0; --i) {
    if (path.extname(files[i]) === '.port') {
      var pid = parseInt(path.basename(files[i], '.port'), 10);
      if (is_running(pid)) {
        var port = parseInt(fs.readFileSync(PID_DIR + path.sep + files[i]).toString(), 10);
        busyPorts[port] = 1;
      }
    }
  }
  var smppPort = SMPP_PORT_RANGE[0];
  for (smppPort; smppPort <= SMPP_PORT_RANGE[1] + 1; ++smppPort) {
    if (!busyPorts[smppPort]) { break; }
  }
  if (smppPort > SMPP_PORT_RANGE[1]) return 0;
  return smppPort;
}

var portLocks = {};
/**
 * Sets lock for a port for a minute
 */
function setPortLocks(ports) {
  var i, ii = ports.length;
  for (i = ii - 1; i >= 0; --i) {
    if (portLocks[ports[i]] && portLocks[ports[i]] > (new Date()).getTime()) { // Lock is set
      return false;
    }
  }
  for (i = ii - 1; i >= 0; --i) {
    portLocks[ports[i]] = (new Date()).getTime() + 60000;
  }
  return true;
}
/**
 * Remove lock for a port
 */
function removePortLocks(ports) {
  var i;
  for (i = ports.length - 1; i >= 0; --i) {
    if (portLocks[ports[i]]) {
      delete portLocks[ports[i]];
    }
  }
}
/**
 * Spawns process
 */
function doSpawn(opts) {
  var runLog = LOGS_DIR + path.sep + 'run-' + opts.imsi + '.log';
  var errLog = LOGS_DIR + path.sep + 'error-' + opts.imsi + '.log';
  var pargs = [SERVER_PATH, '--config', 'cfg.ini', '--modem', opts.ports.join(','), '--sqlite', opts.dbFile, '--smpp', opts.smpp, '--pid', PID_DIR];
  rufus.info('Spawn process on port %s for ports %s with IMSI: %s', opts.smpp, opts.ports.join(','), opts.imsi);
  var child = spawn(process.argv[0], pargs, {
    // stdio: 'inherit'
    stdio: [null, fs.openSync(runLog, "a"), fs.openSync(errLog, "a")]
  });
  child.on ('exit', function (code, signal) {
    rufus.error('child %d exited!', opts.smpp);
  });

  delete tmpSMPPPorts[opts.smpp];
  removePortLocks(opts.ports);
  
  return child;
}


/**
 * Prepares and spawns a process
 */
function SpawnProcess(ports) {
  var opts = {
    ports: ports,
    smpp: GetFreeSMPPPort()
  };
  if (opts.smpp === 0) {
    rufus.error('No free ports for: %s', ports.join(','));
    return;
  }
  if (!setPortLocks(ports)) {
    rufus.error('Ports %s are already locked', ports.join(','));
    return;
  }
  tmpSMPPPorts[opts.smpp] = 1;

  var modem = new Modem({
    ports: opts.ports
  });
  modem.connect(function (err) {
    if (err) {
      rufus.error('Modem %s start failed: %s', ports[0], err.message);
      delete tmpSMPPPorts[opts.smpp];
      removePortLocks(ports);
      return;
    }
    modem.getIMSI(function(err, imsi) {
      if (err) {
        rufus.error("Unable to get IMSI for %s: %s", ports[0], err.message);
        delete tmpSMPPPorts[opts.smpp];
        removePortLocks(ports);
        return;
      }
      opts.imsi = imsi;
      rufus.debug('IMSI: %s port: %s device: %s', imsi, opts.smpp, opts.ports);
      modem.close(function () {

        opts.dbFile = DB_DIR + path.sep + opts.imsi+'.sqlite';
        var proc;
        fs.exists(opts.dbFile, function(exists) {
          if (!exists) {
            fs.copy (ORIG_DATABASE, opts.dbFile, function () {
              proc = doSpawn(opts);
            });
          } else {
            proc = doSpawn(opts);
          }
        });
      });

    });
  });
}






setInterval (function () {

  getSerials().then(
    function (devices) {
      var d, smpp;
      for (d in devices) {
        var running = false, smppPort = 0;
        //Search for pid file first
        var files = fs.readdirSync(PID_DIR);
        var i, ii = files.length, j, jj = devices[d].length;
        for (i = ii - 1; i>=0; --i) {
          if (running) { break; }
          var fileBaseName = path.basename(files[i], '.pid');
          for (j = jj - 1; j>=0; --j) {
            if (path.basename(devices[d][j]) === fileBaseName) {
              var normalPath = path.normalize(PID_DIR + path.sep + files[i]);
              var pid = parseInt(fs.readFileSync(normalPath).toString(), 10);
              var smppPortFile = PID_DIR + path.sep + pid + '.port';
              if(is_running(pid)) {
                running = true;
                smppPort = parseInt(fs.readFileSync(smppPortFile).toString(), 10);
              } else {
                fs.unlinkSync(normalPath);
                if (fs.existsSync(smppPortFile)) {
                  fs.unlinkSync(smppPortFile);
                }
              }
              break;
            }
          }
        }
        if (!running) {
          rufus.info('modem %s is NOT running', devices[d][0]);
          var proc = SpawnProcess(devices[d]);
        } else {
          rufus.debug('modem %s is running on port %s', devices[d][0], smppPort);
        }
      }
    }
  ).catch(
    function (err) {
      rufus.error('Error searching ports %s', err.message);
    }
  );

}, 15000);






function getSerials() {
  var deferred = Q.defer();

  Q.ninvoke(fs, 'readdir', SERIALS_DIR).then(
    function(dir) {
      rufus.debug("Read directories: %s", dir);
      var i, dirLength = dir.length, promises = [];
      for (i = dirLength - 1; i >= 0; --i) {
        promises.push(Q.ninvoke(fs, 'readlink', SERIALS_DIR+dir[i]));
      }
      return Q.all(promises);
    }, 
    function (err) {
      rufus.error('Error reading serial devices: ', err);
      deferred.reject(err);
    }
  ).then(
    function (links) {
      rufus.debug('Resolved links: ', links);
      var i, linksLength = links.length;
      var devices = {};
      for(i = linksLength - 1; i >= 0; --i) {
        var serialPath = serialDir(SERIALS_DIR + links[i]);
        var dev = devFromSerialPath(serialPath);
        if (undefined === devices[dev]) {
          devices[dev] = getAllSerials(dev, links);
        }
      }
      deferred.resolve(devices);
    }, 
    function (err) {
      rufus.error('Error reading link %s', err);
      deferred.reject(err);
    }
  ).catch(function (err) {
    deferred.reject(err);
  });

  return deferred.promise;
}

function serialDir(p) {
  return path.dirname(path.normalize(p));
}

function devFromSerialPath(p) {
  return p.substr(0, p.lastIndexOf('.'));
}

function getAllSerials(dev, links) {
  var i, linksLength = links.length, ret = [], dev2;
  for(i = linksLength - 1; i >= 0; --i) {
    dev2 = devFromSerialPath(serialDir(SERIALS_DIR + links[i]));
    if (dev2 === dev) {
      ret.push('/dev/' + path.basename(links[i]));
    }
  }
  return ret;
}

