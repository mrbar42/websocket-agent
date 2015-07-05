'use strict';

var io;
try {
    io = require("socket.io/node_modules/socket.io-client");
} catch (e) {
    io = require("socket.io-client");
}
var EventEmitter = require('events').EventEmitter;
var utils = require('../utils/utils');

var middleware = require('./middleware');

var E = require('../utils/errors');
var Log = require('../utils/Log');
Log.level = Log.LOG;
var logPrefix = "AGENT: ";

var _defaultConf = {
    timeout: 15e3
};
var _state = {
    isAuthorized: null,
    isReady: false,
    flow: Promise.resolve()
};
var _incomingMiddleware = [];
var _outgoingMiddleware = [];
var _tunnelCache = {};
var _commandHandlers = {
    __all__: []
};

var Agent = new EventEmitter();
module.exports = exports = Agent;

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
                        Log.e("Failed to get conf data. (15s timeout)");
                    }
                    else {
                        Log.e("Failed to get conf data. promise failed", err);
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
                    _this._conf = utils.merge(_defaultConf, conf);
                });
        });

    return Agent
};

Agent.send = function (event, message) {
    Agent.socket.emit(event, message)
};
Agent.connect = function (serverUrl) {
    var _this = this;
    Promise
        .resolve(_state.flow)
        .then(function () {
            if (Agent.socket) {
                return;
            }

            if (_this._conf.secret) {
                _outgoingMiddleware.push(middleware.signMessage.bind(_this));
                _incomingMiddleware.push(middleware.validateMessage.bind(_this));
            }

            var socket = Agent.socket = io.connect(serverUrl);

            // connection status events
            var events = [
                'connect',
                'disconnect',
                'reconnect',
                'error'
            ];
            events.forEach(function (event) {
                socket.on(event, function (message) {
                    handleConnectionEvent(event, message)
                });
            });


            // Authorization limited events {eventName: handlerFunc(event, message)}
            var limitedEvents = {
                'tunnel': handleTunnelMessage,
                'command': handleCommandMessage,
                'control': proxyEvent
            };
            Object.keys(limitedEvents).forEach(function (event) {
                var handler = limitedEvents[event];
                socket.on(event, function (message) {
                    Log.v(logPrefix, event, message);
                    runMiddleware(_outgoingMiddleware, message)
                        .then(function () {
                            handler(event, message);
                        })
                        .catch(function () {
                            console.log("AGENT: Received invalid message from %s", socket.handshake.address, event, message);
                        });
                });
            });
        })
        .catch(function (err) {
            console.error(err);
            throw err;
        });

    return Agent
};
Agent.control = function (action, data) {
    var message = {
        action: action,
        data: data
    };
    runMiddleware(_outgoingMiddleware, message)
        .then(function () {
            Agent.send('control', message);
        });
};
Agent.tunnel = function (action, body, timeout) {
    var _this = this;
    if (action !== '_hello_' && !_state.isReady) {
        return Promise.reject(Agent.NOT_AUTHORIZED);
    }

    var rand;
    while (!rand) {
        var temp = Math.random().toString(36).substr(2);
        if (!_tunnelCache[rand]) {
            rand = temp;
        }
    }
    var cache = _tunnelCache[rand] = {active: true};

    var promise = new Promise(function (resolve, reject) {
        cache.resolve = function (data) {
            if (cache.active) {
                cache.active = false;
                clearTimeout(cache.timer);
                delete _tunnelCache[rand];
                resolve(data)
            }
        };
        cache.reject = function (err) {
            if (cache.active) {
                cache.active = false;
                clearTimeout(cache.timer);
                delete _tunnelCache[rand];
                reject(err)
            }
        };
        cache.active = true;

        cache.timer = setTimeout(function () {
            cache.active && cache.reject(Agent.TIMEOUT);
        }, timeout || _this._conf.timeout);


        var message = {
            rand: rand,
            action: action,
            body: body
        };
        runMiddleware(_outgoingMiddleware, message)
            .then(function (message) {
                Agent.send('tunnel', message);
            })
            .catch(function (err) {
                reject(err);
            })
    });

    promise.timeout = function (func) {
        return promise.catch(function (err) {
            if (err == Agent.timeout) {
                return func(err)
            }

            throw err;
        })
    };
    return promise
};
Agent.commands = function (action, handler) {
    switch (action && typeof action) {
        case 'function':
            _commandHandlers.__all__.push(handler);
            break;
        case 'string':
            if (action == '__all__') {
                console.error("AGENT: can't used __all__ as command key - reserved key");
                break
            }
            if (!handler || typeof handler != 'function') {
                console.error("AGENT: An handler is must be provided when calling commands. ({string} action, {function} handler)");
                break
            }

            if (!_commandHandlers[action]) {
                _commandHandlers[action] = [];
            }
            _commandHandlers[action].push(handler);
            break;
        case 'object':
            Object.keys(action).forEach(function (key) {
                if (key == '__all__') {
                    console.error("AGENT: can't used __all__ as command key - reserved key");
                    return
                }
                if (!action[key] || typeof action[key] != 'function') {
                    console.error("AGENT: An handler is must be provided when calling commands. ({string} action, {function} handler)");
                    return
                }

                if (!_commandHandlers[key]) {
                    _commandHandlers[key] = [];
                }
                _commandHandlers[key].push(action[key]);
            });

            break;
        default:
            console.error("AGENT: Called 'commands' property with invalid argument [%s] %s", typeof action, action);
            break
    }

    return Agent
};
Agent.use = function (event, factory) {
    if (!factory) {
        console.log("You must provide a factory function for middleware '%s'", event);
        return
    }

    switch (event) {
        case 'outgoingMessage':
            _outgoingMiddleware.push(factory);
            break;
        case 'incomingMessage':
            _incomingMiddleware.push(factory);
            break;
        default:
            console.log("Unknown middleware event", event);
            break;
    }
};

// add constants
Object.keys(E).forEach(function (constant) {
    Object.defineProperty(Agent, constant, {writable: false, value: E[constant]});
});

// internal events
Agent.on('wrongSecret', function () {
    _state.isAuthorized = false;
    emitError({code: Agent.WRONG_SECRET});
});
Agent.on('authorize', function () {
    if (_state.isAuthorized) {
        if (!_state.isReady) {
            _state.isReady = true;
            Agent.emit('ready');
        }
        return;
    }

    Agent
        .tunnel('_hello_', {})
        .then(function (response) {
            _state.isAuthorized = true;
            Log.d(logPrefix + "Successfully authorized to master. now ready");

            if (response && response.newIdentity) {
                Agent._conf.identity = response.newIdentity;
                Agent.emit('newIdentity', response.newIdentity);
            }

            if (!_state.isReady) {
                _state.isReady = true;
                Agent.emit('ready');
            }
        })
        .catch(function (err) {
            switch (err) {
                case Agent.TIMEOUT:
                    Log.v(logPrefix + "Hello message timeout");
                    Agent.emit('authorize');
                    break;
                case Agent.WRONG_SECRET:
                    Agent.emit('wrongSecret');
                    break;
                default:
                    Log.e(logPrefix + "error on hello message", err);
                    break;
            }
        });
});

// message handlers
function handleConnectionEvent(event, message) {
    switch (event) {
        case 'connect':
            Agent.emit('authorize');
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
function handleTunnelMessage(event, message) {
    var rand = message && message.rand;

    if (!rand) {
        console.warn("Tunnel: no rand provided. ignoring message", message);
        return
    }

    if (!_tunnelCache[rand]) {
        console.warn("Tunnel rand wasn't found - probably an old message");
        return
    }

    var cache = _tunnelCache[rand];
    if (cache.active) {

        if (message.error) {
            cache.reject(message.error);
        }
        else {
            cache.resolve(message.body);
        }
    }
}
function handleCommandMessage(socket, message) {
    var _this = this;
    if (!message) {
        console.warn("SERVER: received tunnel message without payload - ignoring message");
        return
    }

    var rand = message.rand;
    if (!rand) {
        console.warn("SERVER: no rand provided. ignoring message", message);
        return
    }

    var action = message.action;
    if (!action) {
        console.warn("SERVER: no action provided. ignoring message", message);
        return
    }

    var promise = Promise.resolve();

    if (!_commandHandlers[action] && _commandHandlers.__all__) {
        console.warn("SERVER: No handler was registered for '%s' tunnel event. ignoring message", action);
    }

    promise.then(function () {
        return runMiddleware(_commandHandlers[action], message.data)
    });
    promise.then(function () {
        return runMiddleware(_commandHandlers.__all__, message.data)
    });

    promise
        .then(function (body) {
            var response = {
                rand: rand,
                body: body
            };

            socket.emit('tunnel', response)
        })
        .catch(function (err) {
            var response = {
                rand: rand
            };

            if (err instanceof Error) {
                console.error("Agent: command error", err);
                response.error = "Internal Server Error";
            }
            else {
                response.error = util.inspect(err);
            }

            socket.emit('tunnel', response)
        })
}
function proxyEvent(event, message) {
    Agent.emit(event, message);
}

function runMiddleware(factories, message) {
    var promise = Promise
        .resolve(message);

    if (!factories || !factories.length) {
        return promise;
    }

    factories.forEach(function (factory) {
        promise = promise
            .then(function () {
                return message
            })
            .then(factory)
            .then(function (result) {
                if (result && result !== message) {
                    message = result
                }

                return message;
            })
    });

    return promise
}

function emitError(err) {
    if (!Agent.listeners('error').length) {
        throw new Error(err).stack
    }

    Agent.emit('error', err);
}

function timeout(ms) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            reject(Agent.TIMEOUT);
        }, ms)
    })
}
