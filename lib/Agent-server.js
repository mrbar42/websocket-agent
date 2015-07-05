'use strict';

var EventEmitter = require('events').EventEmitter;
var socketIO = require("socket.io");
var util = require('util');

var utils = require('../utils/utils');

var middleware = require('./middleware');

var E = require('../utils/errors');
var Log = require('../utils/Log');
Log.level = Log.LOG;
var logPrefix = "AgentServer: ";

var _defaultConf = {
    timeout: 15e3
};

/**
 * @enum {string}
 * @readonly
 */
var PROTOCOL = {
    WS: 'ws',
    WSS: 'wss'
};

/**
 * AgentServer server constructor.
 * @class
 *
 * @param {object} [conf]
 * @param {string} conf.secret - secret key to verify remote connection
 * @param {string|number} [conf.port] - port to listen on - defaults to ws:80/wss:443
 * @param {PROTOCOL} [conf.protocol] - defaults to WS
 * @param {string} [conf.privateKey] - path to ssl server key (required only if WSS)
 * @param {string} [conf.certificate] - path to ssl server certificate (required only if WSS)
 *
 * @example
 * var server = new AgentServer({port: 80});
 * server.listen()
 *
 * // access the underlying server
 * server.io.on('connection', function (socket) {  })
 *
 */
var AgentServer = function (conf) {
    this._tunnelHandlers = {
        __all__: []
    };
    this._incomingMiddleware = [];
    this._outgoingMiddleware = [];


    if (conf.debug) {
        Log.level = Log.VERBOSE;
    }

    if (!conf.protocol) {
        conf.protocol = PROTOCOL.WS;
    }

    if (!conf.port) {
        conf.port = conf.protocol == PROTOCOL.WS ? 80 : 443
    }

    this._conf = utils.merge(_defaultConf, conf);

    if (!conf.secret) {
        Log.e(logPrefix + "A secret string must be provided on construction.");
        process.exit(1)
    }
    else {
        this._incomingMiddleware.push(middleware.validateMessage.bind(this));
        this._outgoingMiddleware.push(middleware.signMessage.bind(this))
    }

    this.server = getWebServer(conf);

    this.io = socketIO(this.server);

    this.io.on('connection', onConnection.bind(this));

    this.server
        .listen(conf.port, onServerReady.bind(this))
        .on('error', onServerError.bind(this));
};
// eventEmitter
AgentServer.prototype = Object.create(EventEmitter.prototype);
// constants
Object.keys(E).forEach(function (constant) {
    Object.defineProperty(AgentServer.prototype, constant, {writable: false});
});
AgentServer.prototype.WS = PROTOCOL.WS;
AgentServer.prototype.WSS = PROTOCOL.WSS;

AgentServer.prototype.onTunnel = function (action, handler) {
    var tunnelHandlers = this._tunnelHandlers;
    switch (action && typeof action) {
        case 'function':
            tunnelHandlers.__all__.push(action);
            break;
        case 'string':
            if (action == '__all__') {
                Log.w(logPrefix + "can't used __all__ as Tunnel key - reserved key");
                break
            }
            if (!handler || typeof handler != 'function') {
                Log.w(logPrefix
                      + "An handler is must be provided when calling onTunnel. ({string} action, {function} handler)");
                break
            }

            if (!tunnelHandlers[action]) {
                tunnelHandlers[action] = [];
            }
            tunnelHandlers[action].push(handler);
            break;
        case 'object':
            Object.keys(action).forEach(function (key) {
                if (key == '__all__') {
                    Log.w(logPrefix + "can't used __all__ as Tunnel key - reserved key");
                    return
                }
                if (!action[key] || typeof action[key] != 'function') {
                    Log.w(logPrefix
                          + "An handler is must be provided for each action when calling onTunnel. ({string} action, {function} handler)");
                    return
                }

                if (!tunnelHandlers[key]) {
                    tunnelHandlers[key] = [];
                }
                tunnelHandlers[key].push(action[key]);
            });

            break;
        default:
            Log.w(logPrefix + "Called 'commands' property with invalid argument [%s] %s", typeof action, action);
            break
    }

    return AgentServer
};
AgentServer.prototype.use = function (event, factory) {
    if (!factory) {
        Log.w("You must provide a factory function for middleware '%s'", event);
        return
    }

    switch (event) {
        case 'outgoingMessage':
            this._outgoingMiddleware.push(factory);
            break;
        case 'incomingMessage':
            this._incomingMiddleware.push(factory);
            break;
        default:
            Log.w("Unknown middleware event -> %s", event);
            break;
    }
};

module.exports = exports = AgentServer;

// server initiation
function onServerReady() {
    var conf = this._conf;
    var serverInfo = this.server.address();
    var port = serverInfo.port;
    var host = serverInfo.address == '::' ? 'localhost' : serverInfo.address;
    Log("WebSocket is listening on %s://%s:%s.", conf.protocol, host, port);
}
function onServerError(err) {
    var conf = this._conf;
    switch (err && err.code) {
        case 'EACCES':
            Log.e(logPrefix + "FATAL: '%s' doesn't have permission to start server on port %s. [%s]",
                process.env.USER || 'current user',
                conf.port, err.message);
            process.exit(1);
            break;
        case 'EADDRINUSE':
            Log.e(logPrefix + "FATAL: port %s is already in use. [%s]",
                conf.port, err.message);
            process.exit(1);
            break;
        default:
            Log.e(logPrefix + "FATAL: error starting webSocket server on port %s. [%s]",
                conf.port, err.message);
            process.exit(1);
            break
    }
}

// socket handlers
function onConnection(socket) {
    var _this = this;
    Log.v(logPrefix + "socket Connected!");
    socket.on('_tunnel', function (message) {
        Log.v(logPrefix + "received Tunnel message -> ", message && message.action);

        Promise
            .resolve(message)
            .then(function (message) {
                return runMiddleware(_this._incomingMiddleware, message)
            })
            .then(function () {
                return handleTunnelMessage
                    .call(_this, message)
                    .then(function (response) {
                        return runMiddleware(_this._outgoingMiddleware, response)
                            .then(function () {
                                socket.emit('_tunnel', response);
                            })

                    })
            })
            .catch(function (err) {
                Log.v(logPrefix + "Middleware error", err);
                socket.emit('_tunnel', {
                    rand: message && message.rand,
                    error: err
                })
            })

    });

    socket.on('disconnect', function () {
        Log.v(logPrefix + "socket Disconnected!");
    })
}
function handleTunnelMessage(message) {
    var _this = this;
    if (!message) {
        Log(logPrefix + "received tunnel message without payload - ignoring message");
        return
    }

    var rand = message.rand;
    if (!rand) {
        Log(logPrefix + "no rand provided in tunnel message. ignoring message", message);
        return
    }

    var action = message.action;
    if (!action) {
        Log(logPrefix + "no action provided in tunnel message. ignoring message", message);
        return
    }

    if (action == '_hello_') {
        _this.emit('agentConnected', message.body);
        return Promise.resolve({rand: rand})
    }

    var promise = Promise.resolve(message);

    if (!_this._tunnelHandlers[action] && !_this._tunnelHandlers.__all__.length) {
        Log.w("No handler was registered for '%s' tunnel event. ignoring message", action);
    }

    promise = promise.then(function (message) {
        return runHandlers(_this._tunnelHandlers.__all__, action, message)
    });
    promise = promise.then(function (message) {
        return runMiddleware(_this._tunnelHandlers[action], message)
    });

    return promise
        .then(function (body) {
            var response = {
                rand: rand,
                body: body
            };
            Log.v(logPrefix + "Tunnel response:", response);
            return response;
        })
        .catch(function (err) {
            var response = {
                rand: rand
            };

            if (err instanceof Error) {
                Log.e(logPrefix + "AgentServer: tunnel error", err);
                response.error = "Internal Server Error";
            }
            else {
                response.error = util.inspect(err);
            }

            return response
        })
}

/**
 *
 * @param {object} conf
 * @returns {object} http/s server instance
 */
function getWebServer(conf) {
    var server;
    switch (conf.protocol) {
        case PROTOCOL.WS:
            server = require("http").createServer();
            break;
        case PROTOCOL.WSS:
            if (!conf.privateKey || !conf.certificate) {
                Log.e("wss WebSocket requires privateKey and certificate in server options");
                process.exit(1);
            }

            var fs = require('fs');
            var https = require('https');
            var privateKey = fs.readFileSync(conf.privateKey, 'utf8');
            var certificate = fs.readFileSync(conf.certificate, 'utf8');
            var credentials = {key: privateKey, cert: certificate};

            server = https.createServer(credentials);

            break;
        default:
            Log.e(logPrefix + "FATAL: Invalid protocol -> %s", conf.protocol);
            process.exit(1);
            break;
    }

    return server;
}

// message manipulators
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
function runHandlers(factories, action, message) {
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
            .then(function () {
                return factory(action, message)
            })
            .then(function (result) {
                if (result && result !== message) {
                    message = result
                }

                return message;
            })
    });

    return promise
}