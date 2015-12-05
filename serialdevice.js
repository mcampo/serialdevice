var util = require('util');
var EventEmitter = require('events').EventEmitter;
var serialport = require("serialport");
var debug = require('debug')('serialdevice');

function SerialDevice(path) {
    var self = this;
    self.serialPort = new serialport.SerialPort(path, {
        parser: serialport.parsers.readline('\n', 'ascii'),
        baudrate: 9600
    }, false);
    self.pingInterval = 30000;
    self.pingTimeout = 10000;
    self.isConnectionAlive = false;

}
util.inherits(SerialDevice, EventEmitter);

SerialDevice.prototype.connect = function (callback) {
    var self = this;
    self.pingTimeoutTimer = null;
    callback = callback || function () {};

    var verifyConnection = function () {
        var pongTimeout;
        //send initial ping and wait for pong before notifying about connection
        self.sendRaw('ping\n');
        self.serialPort.once('data', function (data) {
            if (data === 'pong') {
                clearTimeout(pongTimeout);
                onConnectionVerified();
            }
        });
        pongTimeout = setTimeout(function () {
            callback(new Error('Could not establish connection'));
        }, self.pingTimeout);
    };

    var onConnectionVerified = function () {
        self.isConnectionAlive = true;

        self.serialPort.on('error', function() {
            debug('Serialport error event', arguments);
        });

        self.serialPort.on('close', function() {
            debug('Serialport connection closed');
            self.emit('disconnect');
        });

        self.serialPort.on('data', function (data) {
            debug('Received data from device:', data);
            if (data === 'pong') {
                clearTimeout(self.pingTimeoutTimer);
                setTimeout(self.sendPing.bind(self), self.pingInterval);
            }
        });

        setTimeout(self.sendPing.bind(self), self.pingInterval);

        callback();
    };

    self.serialPort.open(function (error) {
        if (error) {
            debug('Error opening serialport', error);
            callback(error);
            return;
        }

        debug('Serialport connection opened');
        verifyConnection();
    });

};

SerialDevice.prototype.sendRaw = function (data, callback) {
    var self = this;
    debug('Sending data to device:', data);
    self.serialPort.write(data, function (error, result) {
        if (error) {
            debug('Error sending data to device', error);
        }
        if (callback) {
            callback(error, result);
        }
    });
};

SerialDevice.prototype.sendData = function (data, callback) {
    var self = this;

    if (!self.isConnected()) {
        debug('Device is not connected, cannot send data');
        if (callback) {
            callback(new Error('Device not connected'));
        }
        return;
    }

    self.sendRaw(data + '\n', callback);
};

SerialDevice.prototype.sendPing = function () {
    var self = this;
    self.sendRaw('ping\n');
    self.pingTimeoutTimer = setTimeout(function () {
        self.isConnectionAlive = false;
        self.serialPort.close();
    }, self.pingTimeout);
};

SerialDevice.prototype.isConnected = function () {
    var self = this;
    return self.serialPort.isOpen() && self.isConnectionAlive;
};

module.exports = SerialDevice;