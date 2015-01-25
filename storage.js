var sqlite3 = require('sqlite3');
var crypto = require('crypto');
var Q = require('q');

function Storage(filename) {
  this.connected = false;
  this.db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE, function () {
    this.connected = true;
  }.bind(this));
}

Storage.prototype.setIMSI = function (imsi) {
  this.IMSI = imsi;
};

Storage.prototype.addOutboxSMS = function (message) {
  var deferred = Q.defer();
  this.db.run("INSERT INTO `outbox` (`destination`, `destination_type`, `message`, `esme_id`, `submit_ts`, `report_requested`, `imsi`) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    message.destination,
    message.destination_type,
    message.message,
    message.esme_id,
    message.submit_ts,
    message.report_requested,
    this.IMSI
  ], function (err) {
    if (err) {
      deferred.reject(err);
    } else {
      deferred.resolve(this.lastID);
    }
  });
  return deferred.promise;
};
/**
 * Marks the message as sent
 */
Storage.prototype.setMessageSent = function (message, refIds) {
  message.parts = refIds.length;

  var promises = [];
  refIds.forEach(function (refId) {
    promises.push(this.addReferenceForMessage(message, refId));
  }.bind(this));

  return Q.all(promises).then(
    function () {
      return Q.ninvoke(this.db, "run", "INSERT INTO `sentitems` (`id`, `destination`, `destination_type`, `message`, `esme_id`, `parts`, `submit_ts`, `sent_ts`, `report_requested`, `status`, 'imsi') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        message.id,
        message.destination,
        message.destination_type,
        message.message,
        message.esme_id,
        message.parts,
        message.submit_ts,
        this.getTS(),
        message.report_requested,
        'SendingOK',
        this.IMSI
      ]);
    }.bind(this),
    function (err) {
      console.error('Error inserting references', err.message);
    }
  ).then(
    function () {
      return this.deleteOutboxMessage(message);
    }.bind(this),
    function (err) {
      console.error('Error inserting message to sentitems', err.message);
    }
  );
};
/**
 * Adds message reference id for the message
 */
Storage.prototype.addReferenceForMessage = function (message, referenceId) {
  return Q.ninvoke(this.db, "run", "INSERT INTO `message_references` (`message_id`, `reference_id`, `destination`) VALUES (?, ?, ?)", [
    message.id,
    referenceId,
    message.destination
  ]);
};

Storage.prototype.deleteOutboxMessage = function (message) {
  return Q.ninvoke(this.db, "run", "DELETE FROM `outbox` WHERE `id` = ?", [message.id]);
};

Storage.prototype.markFailure = function (message) {
  return Q.ninvoke(this.db, "run", "UPDATE `outbox` SET `failures` = `failures` + 1 WHERE `id` = ?", [message.id]);
};

Storage.prototype.giveUpSendingMessage = function (message, reason) {
  return Q.ninvoke(this.db, "run", "INSERT INTO `sentitems` (`id`, `destination`, `destination_type`, `message`, `esme_id`, `parts`, `submit_ts`, `sent_ts`, `report_requested`, `status`, `imsi`, `error`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    message.id,
    message.destination,
    message.destination_type,
    message.message,
    message.esme_id,
    0,
    message.submit_ts,
    '0',
    message.report_requested,
    'SendingError',
    this.IMSI,
    reason
  ]).then(
    function () {
      return this.deleteOutboxMessage(message);
    }.bind(this),
    function (err) {
      console.error('Error while giving up sending message:', err.message);
    }
  );
};

Storage.prototype.getOutboxMessages = function () {
  return Q.ninvoke(this.db, "all", "SELECT * FROM `outbox` ORDER BY `submit_ts` ASC");
};


Storage.prototype.getUserId = function (userId, password) {
  var deferred = Q.defer();
  var passwordHash = crypto.createHash('sha1');
  passwordHash.update(password);
  passwordHash = passwordHash.digest('hex');
  this.db.get("SELECT `id` FROM `esme` WHERE `login` = ? AND `password` = ?", [userId, passwordHash], function (err, row) {
    if (err) {
      deferred.reject(err);
    } else {
      if (undefined === row) {
        deferred.reject(new Error('unauthorized'));
      } else {
        deferred.resolve(row.id);
      }
    }
  });
  return deferred.promise;
};

Storage.prototype.getMessageForReference = function (refId, number) {
  var deferred = Q.defer();
  this.db.get("SELECT `message_id` FROM `message_references` WHERE `reference_id` = ? AND `destination` = ?", [refId, number], function (err, row) {
    if (undefined === row) {
      if (undefined === err) {
        deferred.reject(err);
      } else {
        deferred.reject(new Error('Message not found'));
      }
    } else {
      this.db.get("SELECT * FROM `sentitems` WHERE `id` = ?", [row.message_id], function (err, row) {
        if (undefined === row) {
          if (null !== err) {
            deferred.reject(err);
          } else {
            deferred.reject(new Error('Message not found'));
          }
        } else {
          deferred.resolve(row);
        }
      });
    }
  }.bind(this));
  return deferred.promise;
};

Storage.prototype.setReferenceStatus = function (refId, number, status) {
  return Q.ninvoke(this.db, "run", "UPDATE `message_references` SET `status` = ?, `status_ts` = ? WHERE `reference_id` = ? AND `destination` = ?", [
    status,
    Math.floor((new Date()).getTime() / 1000),
    refId,
    number
  ]);
};

Storage.prototype.setMessageStatus = function (message, report) {
  var status = "Status " + report.status;

  var repStatus = parseInt(report.status, 16);

  if (repStatus === 0) {
    status = 'DeliveredOK';
  } else if (repStatus & 0x40) {
    status = 'Rejected';
  } else if (repStatus & 0x20) {
    status = 'Enroute';
  }
  return Q.ninvoke(this.db, "run", "UPDATE `sentitems` SET `delivered_ts` = ?, `status` = ? WHERE id = ? AND `destination` = ?", [this.getTS(), status, message.id, message.destination]);
};

Storage.prototype.getPartsWithStatus = function (msgId, number) {
  var deferred = Q.defer();
  this.db.get("SELECT COUNT(`reference_id`) as cnt FROM `message_references` WHERE `status` IS NOT NULL AND `message_id` = ? AND `destination` = ?", [
    msgId,
    number
  ], function (err, row) {
    if (undefined !== row) {
      deferred.resolve(row.cnt);
    } else {
      if (null !== err) {
        deferred.reject(err);
      } else {
        deferred.reject(new Error("Message not found"));
      }
    }
  });
  return deferred.promise;
};

Storage.prototype.addInboxMessage = function (message, smsc_tpdu) {
  var deferred = Q.defer();
  this.db.run("INSERT INTO `inbox` (`sender`, `sender_type`, `text`, `received_ts`, `smsc`, `coding`, `imsi`, `smsc_tpdu`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
    message.sender,
    message.sender_type,
    message.text,
    new Date(message.time).getTime() / 1000,
    message.smsc,
    message.dcs,
    this.IMSI,
    smsc_tpdu
  ], function (err) {
    if (null === err) {
      deferred.resolve();
    } else {
      deferred.reject(err);
    }
  });
  return deferred.promise;
};

Storage.prototype.getTS = function () {
  return Math.floor(new Date().getTime() / 1000);
};
/**
 *
 */
Storage.prototype.getSentSMSCount = function (period, status) {
  "use strict";
  var fromTime = Math.floor(((new Date()).getTime() - period) / 1000);
  var where = [fromTime];
  var sql = "SELECT COUNT(*) as cnt FROM `sentitems` WHERE `submit_ts` > ?";
  if (status) {
    sql += " AND `status` = ?";
    where.push(status);
  }
  return Q.ninvoke(this.db, "get", sql, where);
};


module.exports = Storage;
