#!/usr/bin/node
var fs      = require('fs-extra');
var path    = require('path');
var Q       = require('q');
var rufus   = require('rufus');
var spawn   = require('child_process').spawn;
var Modem   = require('gsm-modem');

var SERIALS_DIR = '/sys/bus/usb-serial/devices/';
var SERVER_PATH = './server.js';
var LOGS_DIR = './logs';
var ORIG_DATABASE = 'smsc.sqlite';
var processes = {}; // {smpp:process}

/**
 * Returns first available SMPP port
 */
function GetFreeSMPPPort() {
  var smppPort = 2775;
  for (smppPort; smppPort < 5000; ++smppPort) {
    if (!processes[smppPort]) { break; }
  }
  return smppPort;
}
/**
 * Spawns process
 */
function doSpawn(opts) {
  // var runLog = fs.createWriteStream(LOGS_DIR + path.sep + 'run-' + opts.imsi + '.log');
  // var errLog = fs.createWriteStream(LOGS_DIR + path.sep + 'error-' + opts.imsi + '.log');
  var pargs = [SERVER_PATH, '--config', 'cfg.ini', '--modem', opts.ports.join(','), '--sqlite', opts.dbFile, '--smpp', opts.smpp];
  rufus.debug('Spawn process with args: ', pargs.join(' '));
  var child = spawn(process.argv[0], pargs, {
    // stdio: [null, runLog, errLog]
  });
  child.smpp = opts.smpp;
  child.ports = opts.ports;
  child.on ('exit', function (code, signal) {
    rufus.error('child %d exited!', opts.smpp);
    delete processes[opts.smpp];
  });
  
  return child;
}


function SpawnProcess(ports) {
  var opts = {ports:ports};
  var modem = new Modem({
    ports: opts.ports
  });
  modem.connect(function (err) {
    if (err) {
      rufus.error('Modem start failed: %s', err.message);
      return;
    }
    modem.getIMSI(function(err, imsi) {
      if (err) {
        rufus.error("Unable to get IMSI: %s", err.message);
        return;
      }
      opts.imsi = imsi;
      rufus.info('IMSI: ', imsi);
      modem.close();

      opts.smpp = GetFreeSMPPPort();

      opts.dbFile = opts.imsi+'.sqlite';
      var proc;
      fs.exists(opts.dbFile, function(exists) {
        if (!exists) {
          fs.copy ('smsc.sqlite', opts.dbFile, function () {
            proc = doSpawn(opts);
          });
        } else {
          proc = doSpawn(opts);
        }
        processes[opts.smpp] = proc;
      });

    });
  });
}






setInterval (function () {

  getSerials().then(
    function (devices) {
      var d, smpp;
      for (d in devices) {
        
        var running = false;
        for (smpp in processes) {
          if (processes.hasOwnProperty(smpp)) {
            if (portsEqual(processes[smpp].ports, devices[d])) {
              rufus.debug('modem %s is running on port %s', devices[d][0], smpp);
              running = true;
              break;
            }
          }
        }
        if (!running) {
          rufus.debug('modem %s is NOT running', devices[d][0]);
          var proc = SpawnProcess(devices[d]);
        }
      }
    }
  );

}, 15000);


/**
 * Returns true if two arrays containing same ports
 */
function portsEqual (ports1, ports2) {
  var counter = 0, i, j;
  for(i = 0; i < ports1.length; ++i) {
    for(j = 0; j < ports2.length; ++j) {
      if (ports1[i] == ports2[j]) {
        return true;
      }
    }
  }
  return false;
}






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

