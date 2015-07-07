'use strict';

var EventEmitter = require('events').EventEmitter;
var socketIO = require("socket.io");

var utils = require('../utils/utils');
var httpServer = require('./httpServer');
var AgentCache = require('./AgentCache');
var Hook = require('./Hook');
var middleware = require('./middleware');
var constants = require('./constants');
var PROTOCOL = constants.PROTOCOL;

var E = require('./errors');
var Log = require('../utils/Log');

var logPrefix = "AgentServer: ";
var logPrefixIN = "->AgentServer: ";
var logPrefixOUT = "<-AgentServer: ";

var _defaultConf = {
    timeout: 15e3
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
    var _this = this;

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

    this._emitError = function (err) {
        var hasListeners = this.listeners('error').length;
        if (hasListeners) {
            this.emit('error', err);
        }
        else {
            Log.e("No 'error' listener on AgentServer\n"
                  + "You should add a on('error') your server instance instance.\n",
                err);
        }
    };

    this.cache = new AgentCache();

    this.server = httpServer(conf);

    this._hook = new Hook('_hook', _this._conf.secret);

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


// hooks
AgentServer.prototype.onTunnel = function (action, handler) {
    this._hook.on.apply(this._hook, arguments);
    return AgentServer
};
AgentServer.prototype.command = function (agent, action, message) {
    Log.v(logPrefixOUT + "Sending command", action);

    if (agent && !agent._isAgent) {
        agent = this.cache.get(agent);
    }

    if (!agent) {
        Log.w("Invalid agent was provided to command");
        return Promise.reject(E.UNKNOWN_AGENT);
    }
    if (!agent.socket) {
        Log.w("Agent is not connected");
        return Promise.reject(E.AGENT_NOT_CONNECTED);
    }

    Log.d(logPrefixOUT + "Sending command to agent %s", agent.id);
    return this._hook.send(agent.socket, action, message)
};

AgentServer.prototype.commandAll = function (action, message) {
    var _this = this;
    var agents = this.cache.getAll();

    var agentIds = Object.keys(agents);

    if (!agentIds.length) {
        return Promise.reject(E.NO_CONNECTED_AGENTS)
    }
    var tasks = {};

    agentIds.forEach(function (agentId) {
        var agent = agents[agentId];
        tasks[agentId] = _this.command(agent, action, message);
    });


    return utils.all(tasks);
};

AgentServer.prototype.getAgents = function () {
    return this.cache.getAll()
};
AgentServer.prototype.getAgent = function (id) {
    return this.cache.get(id);
};

module.exports = exports = AgentServer;

// socket handlers
function onConnection(socket) {
    var _this = this;
    Log.v(logPrefix + "socket Connected!");

    /* ---Hook setup--- */
    var hook = _this._hook;

    // handle response to our own hook
    socket.on(hook.hookEvent + ':response', function (message) {
        Log.v("Received hook:response", message);

        Promise
            .resolve()
            .then(function () {
                return middleware.validateMessage(message, _this._conf.secret)
            })
            .catch(function () {
                message.isInvalid = true;
            })
            .then(function () {
                return hook.onHookResponse(message);
            });
    });

    // respond to remote hook
    socket.on(hook.hookEvent, function (message) {
        Log.v("Received hook", message);
        var agent = _this.cache.get(socket);

        // validate message
        var promise = Promise
            .resolve()
            .then(function () {
                return middleware.validateMessage(message, _this._conf.secret)
            })
            .catch(function () {
                message.isInvalid = true;
            });

        // hello message
        if (message && message.action == '_hello_') {
            Log.d("Received _hello_ message");
            promise = promise
                .then(function () {
                    var newAgent = _this.cache.save({
                        conf: message.body,
                        socket: socket,
                        ip: socket.handshake.address || socket.request.connection.remoteAddress
                    });
                    if (!agent) {
                        setTimeout(function () {
                            // delay announcement so the Agent will receive response first
                            _this.emit('agentConnected', newAgent);
                        }, 100)
                    }

                    return hook.onRemoteHello(socket, message);
                })
        }
        else {
            // process hook
            promise = promise
                .then(function () {
                    return hook.onRemoteHook(socket, message, agent);
                });
        }

        promise.catch(function (err) {
            _this._emitError(err);
        })
    });
    /* ---Hook setup END--- */

}

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
