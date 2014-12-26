var sqlite3 = require('sqlite3');
var crypto = require('crypto');
var Q = require('q');

function Storage(filename) {
    this.connected = false;
    this.db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE, function () {
        this.connected = true;
    }.bind(this));
}

Storage.prototype.addOutboxSMS = function (esmeId, destination, message) {
    var deferred = Q.defer();
    this.db.run("INSERT INTO outbox (`destination`, `message`, `esme_id`, `submit_ts`) VALUES (?, ?, ?, ?)", [
        destination,
        message,
        esmeId,
        Math.floor((new Date()).getTime() / 1000)
    ], function (err) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(this.lastID);
        }
    });
    return deferred.promise;
};

Storage.prototype.setOutboxReferences = function (msgId, refIds) {
    var error, inserted = 0;
    var deferred = Q.defer();

    var onInsert = function (err) {
        if (err) {
            error = err;
        }
        ++inserted;
        if (inserted === refIds.length) {
            if (undefined === error || null === error) {
                deferred.resolve();
            } else {
                deferred.reject(error);
            }
        }
    };

    this.db.run("UPDATE `outbox` SET `parts` = ? WHERE `id` = ?", [
        refIds.length,
        msgId
    ], function (err) {
        if (null === err) {
            var i = 0;
            for (i; i < refIds.length; ++i) {
                this.db.run("INSERT INTO `outbox_references` (`outbox_id`, `reference_id`) VALUES (?, ?)", [
                    msgId,
                    refIds[i]
                ], onInsert);
            }
        } else {
            deferred.reject(err);
        }
    }.bind(this));

    return deferred.promise;
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

Storage.prototype.getMessageForReference = function (refId) {
    var deferred = Q.defer();
    this.db.get("SELECT `outbox_id` FROM `outbox_references` WHERE `reference_id` = ?", [refId], function (err, row) {
        if (undefined === row) {
            if (undefined === err) {
                deferred.reject(err);
            } else {
                deferred.reject(new Error('Message not found'));
            }
        } else {
            this.db.get("SELECT * FROM `outbox` WHERE `id` = ?", [row.outbox_id], function (err, row) {
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

Storage.prototype.setReferenceDelivered = function (refId, status) {
    var deferred = Q.defer();
    this.db.run("UPDATE `outbox_references` SET `status` = ?, `status_ts` = ? WHERE `reference_id` = ?", [
        status,
        Math.floor((new Date()).getTime() / 1000),
        refId
    ], function (err) {
        if (null === err) {
            deferred.resolve();
        } else {
            deferred.reject(err);
        }
    });
    return deferred.promise;
};

Storage.prototype.getDeliveredParts = function (msgId) {
    var deferred = Q.defer();
    this.db.get("SELECT COUNT(`reference_id`) as cnt FROM `outbox_references` WHERE `status` IS NOT NULL AND `status` = 0 AND `outbox_id` = ?", [
        msgId
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

Storage.prototype.setMessageDelivered = function (msgId) {
    var deferred = Q.defer();
    this.db.run("UPDATE `outbox` SET `delivered_ts` = ? WHERE `id` = ?", [
        Math.floor((new Date()).getTime() / 1000),
        msgId
    ], function (err) {
        if (null === err) {
            deferred.resolve();
        } else {
            deferred.reject(err);
        }
    });
    return deferred.promise;
};

module.exports = Storage;