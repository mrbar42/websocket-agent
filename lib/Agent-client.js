'use strict';

var io;
try {
    io = require("socket.io/node_modules/socket.io-client");
} catch (e) {
    io = require("socket.io-client");
}
var EventEmitter = require('events').EventEmitter;
var utils = require('../utils/utils');

var Hook = require('./Hook');
var middleware = require('./middleware');

var E = require('./errors');
var Log = require('../utils/Log');
var logPrefix = "AGENT: ";
var logPrefixIN = "->AGENT: ";
var logPrefixOUT = "<-AGENT: ";

var _defaultConf = {
    timeout: 15e3
};
var _state = {
    isAuthorized: null,
    emittedReady: false,
    flow: Promise.resolve()
};

var Agent = new EventEmitter();
module.exports = exports = Agent;

/**
 *
 * @param {number} lvl - log level: 0:none, 1:error, 2:warn, 3:log, 4:debug, 5:verbose
 */
Agent.logLevel = function (lvl) {
    Log.level = lvl;
    return Agent
};

Agent.conf = function (arg) {
    var _this = this;

    var promise = Promise.resolve(_state.flow);

    switch (typeof arg) {
        case 'object':
            if (arg) {
                promise = Promise.resolve(arg);
            }
            else {
                promise = Promise.resolve({});
            }
            break;
        case 'function':
            promise = Promise
                .race([
                    arg(),
                    timeout(15e3)
                ])
                .then(function (conf) {
                    return conf || {}
                })
                .catch(function (err) {
                    if (err == Agent.TIMEOUT) {
                        Log.e(logPrefix + "Failed to get conf data. (15s timeout)");
                    }
                    else {
                        Log.e(logPrefix + "Failed to get conf data. promise failed", err);
                    }
                    process.exit(1);
                });
            break;
        case 'undefined':
            promise = Promise.resolve({});
            break;
        default:
            console.error("Agent: Called conf method with invalid argument [%s] %s", typeof arg, arg);
            process.exit(1);
            break;
    }

    _state.flow = _state.flow
        .then(function () {
            return promise
                .then(function (conf) {
                    _this._conf = utils.merge({}, _defaultConf, _this._conf, conf);

                    _this.emit('confLoaded', _this.conf);
                });
        });

    return Agent
};

Agent.connect = function (serverUrl) {
    var _this = this;

    Promise
        .resolve(_state.flow)
        .then(function () {
            if (Agent.socket) {
                return;
            }

            var socket = Agent.socket = io.connect(serverUrl);

            if (!_this._conf.secret) {
                Log.e(logPrefix + "No secret was provided");
                process.exit(1);
            }


            /* ---Hook setup--- */
            var hookEvent = '_hook';
            var hook = Agent._hook = new Hook(hookEvent, _this._conf.secret);

            // handle response to our own hook
            socket.on(hookEvent + ':response', function (message) {
                Log.v("Received hook:response", message);

                Promise
                    .resolve()
                    .then(function () {
                        return middleware.validateMessage(message, _this._conf.secret)
                    })
                    .then(function () {
                        return hook.onHookResponse(message);
                    })
                    .catch(function (err) {
                        Log.v("Received invalid message", err, message)
                    })
            });

            // respond to remote hook
            socket.on(hookEvent, function (message) {
                Log.v("Received hook", message);
                hook.onRemoteHook(socket, message)
            });
            /* ---Hook setup END--- */

            /**
             * Connection status events
             */
            var events = [
                'connect',
                'disconnect',
                'reconnect',
                'error'
            ];
            events.forEach(function (event) {
                socket.on(event, function (message) {
                    handleConnectionEvent(event, message)
                })
            });
        })
        .catch(function (err) {
            emitError(err);
        });

    return Agent
};

Agent.tunnel = function (action, message) {
    if (!_state.isAuthorized) {
        return Promise.reject(E.NOT_READY);
    }
    Log.v(logPrefixOUT + "Sending message", message);
    return Agent._hook.send(Agent.socket, action, message)
};

Agent.onCommand = function (action, handler) {
    var _this = this;
    var args = arguments;
    if (!_state.emittedReady) {
        _state.flow.then(function () {
            _this._hook.on.apply(_this._hook, args);
        });
    }
    else {
        this._hook.on.apply(this._hook, args);
    }
    return Agent
};

// add constants
Object.keys(E).forEach(function (constant) {
    Object.defineProperty(Agent, constant, {writable: false, value: E[constant]});
});

// internal events
Agent.on('_wrongSecret', function () {
    _state.isAuthorized = false;
    emitError(Agent.WRONG_SECRET);
});
Agent.on('_authorize', function () {
    if (_state.isAuthorized) {
        return;
    }


    Agent._hook
        .send(Agent.socket, '_hello_', this._conf || {}, 1e4)
        .then(function (response) {
            _state.isAuthorized = true;
            Agent.emit('authorized', response);
            Log.d(logPrefix + "Successfully authorized to master. now ready");

            if (!_state.emittedReady) {
                _state.emittedReady = true;
                Agent.emit('ready');
            }
        })
        .catch(function (err) {
            switch (err) {
                case Agent.TIMEOUT:
                    Log.v(logPrefix + "Hello message timeout");
                    Agent.emit('_authorize');
                    break;
                case Agent.WRONG_SECRET:
                    Agent.emit('_wrongSecret');
                    break;
                default:
                    Log.e(logPrefixIN + "error on hello message", err);
                    break;
            }
        });
});

// message handlers
function handleConnectionEvent(event, message) {
    switch (event) {
        case 'connect':
            Agent.emit('connected');
            Agent.emit('_authorize');
            break;
        case 'reconnect':
            Agent.emit('reconnected');
            break;
        case 'disconnect':
            Agent.emit('disconnected');
            break;
        default:
            console.error("Unhandled Connection event: '%s' %s", event, message);
            break
    }
}

function emitError(err) {
    var hasListeners = Agent.listeners('error').length;
    if (hasListeners) {
        this.emit('error', err);
    }
    else {
        Log.e("No 'error' listener on AgentServer\n"
              + "You should add a on('error') your server instance instance\n",
            err);
    }
}

function timeout(ms) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            reject(Agent.TIMEOUT);
        }, ms)
    })
}
