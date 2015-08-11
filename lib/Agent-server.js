'use strict';

var io = require("socket.io");
var Log = require('../utils/Log');

// Libs
var Hook = require('./Hook');
var AgentCache = require('./AgentCache');
var httpServer = require('./httpServer');
var utils = require('../utils/utils');
var EventEmitter = require('events').EventEmitter;

// Constants
var constants = require('./constants');
var PROTOCOL = constants.PROTOCOL;
var E = require('./errors');

var _defaultConf = {
    timeout: 15e3
};

var AgentServer = function (conf) {
    var _this = new EventEmitter();
    conf = conf || {};

    // conf validation
    if (conf.debug) {
        Log.level = Log.VERBOSE;
    }

    if (!conf.protocol) {
        conf.protocol = PROTOCOL.WS;
    }
    if (!conf.port) {
        conf.port = conf.protocol == PROTOCOL.WS ? 7788 : 7789
    }

    _this._conf = utils.merge(_defaultConf, conf);

    _this.storedData = Promise.resolve({});
    if (conf.dataStore) {
        _this.storedData = conf.dataStore
            .load()
            .then(function (data) {
                return data || {};
            })
            .catch(function (err) {
                if (err instanceof Error) {
                    console.error(err);
                }
                return {}
            })
    }

    _this.lastName = _this.storedData
        .then(function (data) {
            return data.lastName || '';
        });

    var agentConnected = function (agent, storeChanges) {
        if (conf.dataStore && storeChanges) {
            _this.storedData
                .then(function (data) {
                    data = utils.merge({}, data, {lastName: agent.name});
                    _this.storedData = Promise.resolve(data);
                    _this.lastName = Promise.resolve(agent.name);

                    return conf.dataStore
                        .save(data)
                })
        }
        _this.emit('agentConnected', agent);
    };
    var agentDisconnected = function (agent) {
        _this.emit('agentDisconnected', agent);
    };
    _this.cache = new AgentCache({
        nameFormat: conf.agentNameFormat || 'A#',
        agentConnected: agentConnected,
        agentDisconnected: agentDisconnected

    });

    _this.hook = new Hook();

    _this.server = httpServer(conf);

    _this.io = io(_this.server);
    _this.io.on('connection', function (socket) {
        _this.hook.attach(socket);
    });

    _this.server
        .listen(conf.port, function () {
            var serverInfo = _this.server.address();
            var port = serverInfo.port;
            var host = serverInfo.address == '::' ? 'localhost' : serverInfo.address;
            Log.d("WebSocket is listening on %s://%s:%s.", conf.protocol == PROTOCOL.WS ? 'http' : 'https', host, port);
        })
        .on('error', onServerError);

    _this.hook.onHello(function (message, socket) {
        if (!message) {
            throw E.INVALID_MESSAGE;
        }
        if (message.secret != conf.secret) {
            throw E.WRONG_SECRET;
        }

        var promise = Promise.resolve();

        if (!message.id) {
            promise = _this.lastName;
        }
        return promise
            .then(function (lastName) {
                var id = _this.cache.add(socket, message.id, lastName);
                return {id: id}
            })
            .catch(function (err) {
                if (err instanceof Error) {
                    console.error(err.stack);
                }
                throw err || E.INTERNAL_SERVER_ERROR;
            })
    });

    _this.hook.onHook(function (event, message, socket) {
        var agent = _this.cache.load(socket);

        if (!agent) {
            throw E.NOT_AUTHORIZED;
        }

        return agent;
    });

    _this.on = _this.hook.on;

    _this.sendTo = function (agent, event, message, timeout) {
        if (agent && !agent.socket) {
            agent = _this.cache.load(agent);
        }

        if (!agent) {
            Promise.reject(E.UNKNOWN_AGENT);
        }

        return _this.hook.sendTo(agent.socket, event, message, timeout);
    };

    _this.sendAll = function (event, message) {
        var _this = this;
        var agents = _this.cache.getAll();

        var agentIds = Object.keys(agents);

        if (!agentIds.length) {
            return Promise.reject(E.NO_CONNECTED_AGENTS)
        }
        var tasks = {};

        agentIds.forEach(function (agentId) {
            var agent = agents[agentId];
            tasks[agentId] = _this.sendTo(agent, event, message);
        });

        return utils.all(tasks);
    };

    _this.getAgents = _this.cache.getAll;

    // Add Error constants to the instance
    utils.merge(this, E);

    return _this;

    function onServerError(err) {
        switch (err && err.code) {
            case 'EACCES':
                Log.e("FATAL: '%s' doesn't have permission to start server on port %s. [%s]",
                    process.env.USER || 'current user',
                    conf.port, err.message);
                process.exit(1);
                break;
            case 'EADDRINUSE':
                Log.e("FATAL: port %s is already in use. [%s]",
                    conf.port, err.message);
                process.exit(1);
                break;
            default:
                Log.e("FATAL: error starting webSocket server on port %s. [%s]",
                    conf.port, err.message);
                process.exit(1);
                break
        }
    }
};

// Add constants to constructor
Object.keys(E).forEach(function (constant) {
    Object.defineProperty(AgentServer, constant, {writable: false, value: E[constant]});
});
Object.defineProperty(AgentServer, 'WS', {writable: false, value: PROTOCOL.WS});
Object.defineProperty(AgentServer, 'WSS', {writable: false, value: PROTOCOL.WSS});

module.exports = AgentServer;
