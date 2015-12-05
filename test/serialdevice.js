var proxyquire = require('proxyquire');
var sinon = require('sinon');
var assert = require('chai').assert;
var EventEmitter = require('events').EventEmitter;

function SerialPortMock () {
}

var serialport = {
    SerialPort: SerialPortMock
};
var SerialDevice = proxyquire('../serialdevice.js', {
    'serialport': serialport
});

describe('SerialDevice', function () {
    this.timeout(100);

    var device, serialPortEventEmitter, clock;

    var emulateSerialPortEvent = function (event, data) {
        serialPortEventEmitter.emit(event, data);
    };

    var emulatePong = function () {
        emulateSerialPortEvent('data', 'pong');
    };

    beforeEach(function () {
        clock = sinon.useFakeTimers();

        SerialPortMock.prototype = {};
        SerialPortMock.prototype.open = sinon.stub().callsArg(0);
        SerialPortMock.prototype.isOpen = sinon.stub().returns(true);
        SerialPortMock.prototype.write = sinon.stub().callsArg(1);
        SerialPortMock.prototype.close = function () {};
        sinon.stub(SerialPortMock.prototype, "close", function () { emulateSerialPortEvent('close') });

        serialPortEventEmitter = new EventEmitter();
        SerialPortMock.prototype.on = serialPortEventEmitter.on.bind(serialPortEventEmitter);
        SerialPortMock.prototype.once = serialPortEventEmitter.once.bind(serialPortEventEmitter);

        device = new SerialDevice('/some/path');
    });


    describe('#connect', function () {

        it('should call connect callback with error when serialport connection fails', function (done) {
            SerialPortMock.prototype.open = sinon.stub().callsArgWith(0, new Error());
            device.connect(function (error) {
                assert.isDefined(error);
                done();
            });
        });

        it('should send ping message when serialport connection is successful', function (done) {
            var pingSpy = SerialPortMock.prototype.write.withArgs('ping\n');
            device.connect();
            assert.isTrue(pingSpy.called);
            done();
        });

        it('should call connect callback with no arguments when pong is received', function (done) {
            device.connect(function (error) {
                assert.isUndefined(error);
                done();
            });
            emulatePong();
        });

        it('should call connect callback with error when pong timeout is reached', function (done) {
            device.connect(function (error) {
                assert.isDefined(error);
                done();
            });
            clock.tick(device.pingTimeout);
        });

        it('should only call connect callback once (with no error) when pong is received before timeout', function () {
            var connectCallback = sinon.spy();
            device.connect(connectCallback);
            emulatePong();
            clock.tick(device.pingTimeout);
            assert.isTrue(connectCallback.calledOnce);
            assert.isUndefined(connectCallback.args[0][0]);
        });

        it('should not emit disconnect event when serialport emits close event and initial pong is not received', function () {
            var disconnectCallback = sinon.spy();
            device.on('disconnect', disconnectCallback);
            device.connect();
            emulateSerialPortEvent('close');
            clock.tick(device.pingTimeout);
            assert.isFalse(disconnectCallback.called);
        });

        it('should call connect callback only once', function () {
            var callbackSpy = sinon.spy();
            device.connect(callbackSpy);
            emulatePong();
            emulatePong();
            assert.equal(callbackSpy.callCount, 1);
        });
    });

    describe('#sendData', function () {

        beforeEach(function () {
            device.connect();
            emulatePong();
        });

        it('should call callback with result when serialport write is successful', function (done) {
            var data = 'data';
            var expectedResult = {};
            SerialPortMock.prototype.write = sinon.stub().callsArgWith(1, undefined, expectedResult);
            device.sendData(data, function (error, result) {
                assert.isTrue(SerialPortMock.prototype.write.calledWith(data + '\n'));
                assert.isUndefined(error);
                assert.strictEqual(result, expectedResult);
                done();
            });
        });

        it('should call callback with error when serialport write fails', function (done) {
            var data = 'data';
            var expectedError = new Error();
            SerialPortMock.prototype.write = sinon.stub().callsArgWith(1, expectedError);
            device.sendData(data, function (error, result) {
                assert.isTrue(SerialPortMock.prototype.write.calledWith(data + '\n'));
                assert.strictEqual(error, expectedError);
                done();
            });
        });

        it('should call callback with error when serialport is not open', function (done) {
            SerialPortMock.prototype.isOpen = sinon.stub().returns(false);
            device.sendData('data', function (error) {
                assert.isDefined(error);
                done();
            });
        });

        it('should call callback with error when device is disconnected', function (done) {
            clock.tick(device.pingInterval + device.pingTimeout);
            device.sendData('data', function (error) {
                assert.isDefined(error);
                done();
            });
        });

    });

    describe('status check', function () {

        it('should not be connected before connect is called', function () {
            assert.isFalse(device.isConnected());
        });

        it('should not be connected before first pong is received', function () {
            device.connect();
            assert.isFalse(device.isConnected());
        });

        it('should be connected when first pong is received', function () {
            device.connect();
            emulatePong();
            assert.isTrue(device.isConnected());
        });

        it('should not be connected when pong is not received before timeout', function () {
            device.connect();
            emulatePong();
            clock.tick(device.pingInterval + device.pingTimeout);
            assert.isFalse(device.isConnected());
        });

        it('should emit disconnect event if pong is not received before timeout', function (done) {
            device.on('disconnect', done);
            device.connect();
            emulatePong();
            clock.tick(device.pingInterval + device.pingTimeout);
        });

        it('should close serialport connection if pong is not received before timeout', function () {
            device.connect();
            emulatePong();
            clock.tick(device.pingInterval + device.pingTimeout);
            assert.isTrue(SerialPortMock.prototype.close.called);
        });

        it('should be connected when pong is received within timeout threshold', function () {
            var pingSpy = SerialPortMock.prototype.write.withArgs('ping\n');
            device.connect();
            emulatePong();
            assert.equal(pingSpy.callCount, 1);

            for (var i=0; i < 10; i++) {
                clock.tick(device.pingInterval);
                assert.equal(pingSpy.callCount, i + 2);
                clock.tick(device.pingTimeout - 1);
                emulatePong();
            }
            assert.isTrue(device.isConnected());
        });

    });

    describe('serialport event handlers', function () {

        it('should emit disconnect event when serialport emits close event', function (done) {
            device.on('disconnect', done);
            device.connect();
            emulatePong();
            emulateSerialPortEvent('close');
        });

        it('should clear ping timer when serialport emits close event', function () {
            device.sendPing = sinon.spy();
            device.connect();
            emulatePong();
            emulateSerialPortEvent('close');
            clock.tick(device.pingInterval);
            assert.equal(device.sendPing.callCount, 1); //only the initial ping
        });

    });

});