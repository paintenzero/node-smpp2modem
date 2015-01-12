var express = require('express');
var Q = require('q');


function twoDigit(d) {
    return ('0' + d).substr(-2, 2);
}
function formatTime(ts) {
    var d = new Date(ts);
    return twoDigit(d.getDate()) + '.' + twoDigit(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + twoDigit(d.getHours()) + ':' + twoDigit(d.getMinutes()) + ':' + twoDigit(d.getSeconds());
}


function HttpApp() {
    this.app = express();
    this.modem_info = {};
    this.signal_info = {ts: 0};
    this.balance_info = {ts: 0};
    this.modem_serial = null;
    this.__defineGetter__('modem', function () { return this.modem_serial; });
}

HttpApp.prototype.start = function (port, modem) {
    this.app.listen(port, function () {
        console.log('Server started at port %d', port);
    });
    this.modem_serial = modem;
    this.getModemInfo();
    this.setRequestHandlers();
};

HttpApp.prototype.getModemInfo = function () {
    this.modem.getModel(function (err, model) {
        if (undefined === err) {
            this.modem_info.Model = model;
        }
    }.bind(this));

    this.modem.getIMEI(function (err, imei) {
        if (undefined === err) {
            this.modem_info.IMEI = imei;
        }
    }.bind(this));

    this.modem.getIMSI(function (err, imsi) {
        if (undefined === err) {
            this.modem_info.IMSI = imsi;
        }
    }.bind(this));

};

HttpApp.prototype.setRequestHandlers = function () {
    this.app.get('/', function (req, res) {
        var response = '', k;
        for (k in this.modem_info) {
            response += k + ': ' + this.modem_info[k] + '\n';
        }
        this.getSignal().then(
            function (signal_info) {
                response += 'Signal: ' + signal_info.operator + ' ' + signal_info.condition + ' (' + signal_info.strength + 'db)' + ' was at ' + formatTime(signal_info.ts) + '\n';
                return this.getBalance();
            }.bind(this)
        ).then(
            function (balance) {
                response += 'Balance: ' + balance.value + 'rub. was at ' + formatTime(balance.ts);
                res.send(response);
                res.end();
            }
        );

        res.set('Content-Type', 'text/plain');
    }.bind(this));
};


HttpApp.prototype.getSignal = function () {
    var deferred = Q.defer();
    if ((new Date()).getTime() - this.signal_info.ts > 60000) {

        this.modem.getOperator(true, function (err, operator) {
            if (undefined === err) {
                this.signal_info.operator = operator;
            } else {
                this.signal_info.operator = 'No operator';
            }

            this.modem.getSignalStrength(function (err, signal) {
                if (undefined === err) {
                    this.signal_info.strength = signal.db;
                    this.signal_info.condition = signal.condition;
                } else {
                    this.signal_info.strength = 'No signal';
                    this.signal_info.condition = 'No signal';
                }
                this.signal_info.ts = (new Date()).getTime();
                deferred.resolve(this.signal_info);
            }.bind(this));

        }.bind(this));

    } else {
        deferred.resolve(this.signal_info);
    }
    return deferred.promise;
};

HttpApp.prototype.getBalance = function () {
    var deferred = Q.defer();
    if ((new Date()).getTime() - this.balance_info.ts > 3600000) {
        this.modem.getBalance(function (err, balance) {
            if (undefined === err) {
                this.balance_info.value = balance;
            } else {
                this.balance_info.value = '???';
            }
            this.balance_info.ts = (new Date()).getTime();
            deferred.resolve(this.balance_info);
        }.bind(this));
    } else {
        deferred.resolve(this.balance_info);
    }
    return deferred.promise;
};


module.exports.HttpApp = HttpApp;