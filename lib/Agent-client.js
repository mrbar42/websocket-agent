'use strict';

var io;
try {
    io = require("socket.io/node_modules/socket.io-client");
} catch (e) {
    io = require("socket.io-client");
}
var EventEmitter = require('events').EventEmitter;

var Hook = require('./Hook');
var Log = require('../utils/Log');
var utils = require('../utils/utils');
var E = require('./errors');


var Agent = function (conf) {
    var _this = new EventEmitter();
    conf = conf || {};

    if (!conf.host) {
        console.error('Agent: No host was provided. please define host as a property');
    }

    _this.storedData = Promise.resolve({});
    if (conf.dataStore) {
        _this.storedData = conf.dataStore
            .load()
            .then(function (data) {
                return data || {}
            })
            .catch(function (err) {
                if (err instanceof Error) {
                    console.error("Agent dataStore error:", err);
                }
                return {}
            })
    }

    var socketOptions = {
        reconnectionDelayMax: 5e3,
        timeout: 1e4
    };
    var socket = _this.socket = io.connect(conf.host, socketOptions);
    _this.hook = new Hook();
    _this.hook
        .attach(socket)
        .bindSocket(socket);
    _this.onHook = _this.hook.on;

    _this.online = false;
    var pendingHello = null;
    var connected = false;
    var ready = false;

    socket.on('connect', function () {
        if (connected) return;
        connected = true;
        _this.emit('connected');
        authorize();
    });
    socket.on('reconnect', function () {
        authorize();
    });
    socket.on('disconnect', function () {
        _this.online = false;
        _this.emit('disconnected');
    });

    _this.send = function (event, message, timeout) {
        var promise = Promise.resolve();

        if (!_this.online) {
            if (pendingHello) {
                promise = Promise.resolve(pendingHello);
            }
            else {
                return Promise.reject(E.OFFLINE)
            }
        }

        return promise.then(function () {
            return _this.hook.send(event, message, timeout);
        });
    };

    // Add Error constants to the instance
    utils.merge(_this, E);

    return _this;

    function authorize() {
        if (pendingHello || _this.online) {
            return;
        }
        pendingHello = _this.storedData
            .then(function (data) {
                return _this.hook.sendHello({
                    secret: conf.secret,
                    id: data.id
                }, 1e4)
                    .then(function (message) {
                        pendingHello = null;
                        _this.online = true;
                        if (ready) {
                            _this.emit('reconnected');
                        }
                        else {
                            ready = true;
                            _this.emit('ready');
                        }

                        if (message && message.id) {
                            if (conf.dataStore) {
                                _this.storedData
                                    .then(function (data) {
                                        data = utils.merge({}, data, {id: message.id});
                                        _this.storedData = Promise.resolve(data);

                                        return conf.dataStore
                                            .save(data)
                                    })
                            }
                        }
                    })
                    .catch(function (err) {
                        switch (err) {
                            case E.TIMEOUT:
                                Log.v("Hello timeout");
                                setTimeout(function () {
                                    authorize();
                                }, 1000);
                                break;
                            default:
                                emitError(err);
                                break;
                        }
                    })
            })
            .catch(Log.e)
    }

    function emitError(err) {
        var hasListeners = _this.listeners('error').length;
        if (hasListeners) {
            _this.emit('error', err);
        }
        else {
            console.error("No 'error' listener on AgentServer\n"
                          + "You should add a on('error') listener on your agent instance\n",
                err);
        }
    }
};

// Add constants to constructor
utils.merge(Agent, E);

module.exports = Agent;
