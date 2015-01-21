var fs = require('fs');
var path = require('path');
var sqlite3 = require('sqlite3');
var Q = require('q');
var rufus = require('rufus');

var DB_DIR = 'db';
var BACKUP_DB = 'backup.sqlite';
var EXPIRATION_TIME = 3600 * 24 * 2;

if (DB_DIR[0] !== '/') {
	DB_DIR = path.normalize(__dirname + path.sep + DB_DIR);
}
if (BACKUP_DB[0] !== '/') {
  BACKUP_DB = path.normalize(__dirname + path.sep + BACKUP_DB);
}
var backupManager = new BackupManager ({
  backupDB: BACKUP_DB
});


// Find all databases in folder
fs.readdir(DB_DIR, function (err, files) {
	var i, len = files.length, db_path;
	for (i = len - 1; i >= 0; --i) {
		if (path.extname(files[i]) === '.sqlite') {
			db_path = DB_DIR + path.sep + files[i];
      backupManager.addFile(db_path);
		}
	}
  backupManager.backupAll();
});

/**
 *
 */
function BackupManager(opts) {

  var storage = new BackupStorage ({
    path: opts.backupDB
  });
  var files = [];
  var curFileInd = 0;
  var deferred = Q.defer();

  this.addFile = function (filepath) {
    files.push(filepath);
  };
  /**
   *
   */
  this.backupAll = function () {
    this.backupNext();
    return deferred.promise;
  };

  this.backupNext = function () {
    if (curFileInd<files.length) {
      rufus.info('Backing up %s', files[curFileInd]);
      var db = new DBBackuper({
        path: files[curFileInd]
      });
      db.selectSentItems().then(
        storage.saveOutbox.bind(storage)
      ).then(
        db.deleteSentItems.bind(db), 
        function (err) {
          rufus.error('Error saving %s: ', files[curFileInd], err.stack);
        }
      ).then(
        function () {
          rufus.info('Saved %s', files[curFileInd]);
          return db.selectInbox();
        }.bind(this),
        function (err) {
          rufus.error('Error deleting %s: ', files[curFileInd], err.stack);
        }
      ).then(
        storage.saveInbox.bind(storage),
        function (err) {
          rufus.error('Error getting inbox: %s', err.message)
        }
      ).then(
        db.deleteInbox.bind(db),
        function (err) {
          rufus.error('Error saving inbox: %s', err.message);
        }
      ).then(
        function () {
          ++curFileInd;
          this.backupNext();
        }.bind(this),
        function (err) {
          rufus.error('Error deleting inbox: %s', err.message);
        }
      );
    } else {
      deferred.resolve();
    }
  };
}


/**
 * Backuper of SQLite database
 */
function DBBackuper(opts) {
  this.opts = opts;
  this.db = new sqlite3.Database(this.opts.path, sqlite3.OPEN_READ);
}
/**
 *
 */
DBBackuper.prototype.selectSentItems = function() {
  return Q.ninvoke(this.db, "all", "SELECT * FROM `sentitems` WHERE " + this.sentitemsWhereClause, [
    Math.floor((new Date()).getTime() / 1000) - EXPIRATION_TIME
  ]);
};
DBBackuper.prototype.deleteSentItems = function() {
  return Q.ninvoke(this.db, "all", "DELETE FROM `sentitems` WHERE " + this.sentitemsWhereClause(), [
    Math.floor((new Date()).getTime() / 1000) - EXPIRATION_TIME
  ]);
};
DBBackuper.prototype.sentitemsWhereClause = function () {
  return "(`status` = \"SendingError\" OR `status` = \"Rejected\" OR `status` = \"DeliveredOK\") OR (`submit_ts` < ?)";
};
DBBackuper.prototype.selectInbox = function() {
  return Q.ninvoke(this.db, "all", "SELECT * FROM `inbox` WHERE 1");
};
DBBackuper.prototype.deleteInbox = function() {
  return Q.ninvoke(this.db, "all", "DELETE FROM `inbox` WHERE 1");
};


/**
 * Storage for sent and received messages
 */
function BackupStorage(opts) {
  this.opts = opts;
  this.db = new sqlite3.Database(this.opts.path, sqlite3.OPEN_WRITE);
}
BackupStorage.prototype.saveOutbox = function(messages) {
  rufus.info("Saving %d outbox messages", messages.length);
  var promises = [], i, len = messages.length;
  for (i = len - 1; i >= 0; --i) {
    promises.push (this.saveOutboxMessage(messages[i]));
  }
  return Q.all(promises);
};
BackupStorage.prototype.saveOutboxMessage = function(message) {
  return Q.ninvoke(this.db, "run", "INSERT INTO `sentitems` (`id`, `destination`, `destination_type`, `message`, `esme_id`, `parts`, `submit_ts`, `sent_ts`, `delivered_ts`, `report_requested`, `status`, 'imsi', 'error') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    message.id,
    message.destination,
    message.destination_type,
    message.message,
    message.esme_id,
    message.parts,
    message.submit_ts,
    message.sent_ts,
    message.delivered_ts,
    message.report_requested,
    message.status,
    message.imsi,
    message.error
  ]);
};
BackupStorage.prototype.saveInbox = function(messages) {
  rufus.info("Saving %d inbox messages", messages.length);
  var promises = [], i, len = messages.length;
  for (i = len - 1; i >= 0; --i) {
    promises.push (this.saveInboxMessage(messages[i]));
  }
  return Q.all(promises);
};
BackupStorage.prototype.saveInboxMessage = function(message) {
  return Q.ninvoke(this.db, "run", "INSERT INTO `inbox` (`id`, `sender`, `sender_type`, `text`, `received_ts`, `smsc`, `coding`, `processed`, `imsi`, `smsc_tpdu`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    message.id,
    message.sender,
    message.sender_type,
    message.text,
    message.received_ts,
    message.smsc,
    message.coding,
    message.processed,
    message.imsi,
    message.smsc_tpdu
  ]);
};