#!/usr/bin/env node
var fs          = require('fs-extra');
var path        = require('path');
var Q           = require('q');
var rufus       = require('rufus');
var spawn       = require('child_process').spawn;
var Modem       = require('gsm-modem');
var is_running  = require('is-running');

var SERIALS_DIR = '/sys/bus/usb-serial/devices/';
var SERVER_PATH = './server.js';
var LOGS_DIR = './logs';
var ORIG_DATABASE = 'smsc.sqlite';
var DB_DIR = './db';
var PID_DIR = './pids';

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR);
}
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}
if (!fs.existsSync(PID_DIR)) {
  fs.mkdirSync(PID_DIR);
}

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
  var smppPort = 2775;
  for (smppPort; smppPort < 5000; ++smppPort) {
    if (!busyPorts[smppPort]) { break; }
  }
  return smppPort;
}
/**
 * Spawns process
 */
function doSpawn(opts) {
  var runLog = LOGS_DIR + path.sep + 'run-' + opts.imsi + '.log';
  var errLog = LOGS_DIR + path.sep + 'error-' + opts.imsi + '.log';
  var pargs = [SERVER_PATH, '--config', 'cfg.ini', '--modem', opts.ports.join(','), '--sqlite', opts.dbFile, '--smpp', opts.smpp, '--pid', PID_DIR];
  rufus.debug('Spawn process with args: ', pargs.join(' '));
  var child = spawn(process.argv[0], pargs, {
    // stdio: 'inherit'
    stdio: [null, fs.openSync(runLog, "w"), fs.openSync(errLog, "w")]
  });
  child.on ('exit', function (code, signal) {
    rufus.error('child %d exited!', opts.smpp);
  });

  delete tmpSMPPPorts[opts.smpp];
  
  return child;
}


function SpawnProcess(ports) {
  var opts = {
    ports: ports,
    smpp: GetFreeSMPPPort()
  };
  tmpSMPPPorts[opts.smpp] = 1;

  var modem = new Modem({
    ports: opts.ports
  });
  modem.connect(function (err) {
    if (err) {
      rufus.error('Modem %s start failed: %s', ports[0], err.message);
      delete tmpSMPPPorts[opts.smpp];
      return;
    }
    modem.getIMSI(function(err, imsi) {
      if (err) {
        rufus.error("Unable to get IMSI for %s: %s", ports[0], err.message);
        delete tmpSMPPPorts[opts.smpp];
        return;
      }
      opts.imsi = imsi;
      rufus.info('IMSI: %s port: %s device: %s', imsi, opts.smpp, opts.ports);
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
              rufus.debug('Found pid for port %s', devices[d][j]);
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
          rufus.debug('modem %s is NOT running', devices[d][0]);
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

