'use strict';

var E = require('./errors');

var AgentCache = function (conf, store) {
    var _this = this;
    conf = conf || {};

    var minimumDigits = conf.nameFormat.replace(/[^#]*(#+).*/, '$1').length || 1;
    var connectedSockets = Object.create(null);
    var socketToNameMap = Object.create(null);

    this.add = function (socket, name, lastName) {
        var newName = false;
        if (!name) {
            name = getNextName(conf.nameFormat, lastName, minimumDigits);
            newName = true;
        }

        if (!connectedSockets[name]) {
            connectedSockets[name] = {
                name: name,
                socket: socket,
                firstTime: newName
            };
            socketToNameMap[socket.id] = name;
            socket.on('disconnect', function () {
                _this.remove(socket)
            });

            conf.agentConnected && conf.agentConnected(connectedSockets[name], newName);

            return newName && name;
        }
        else if (connectedSockets[name].name !== name) {
            throw E.DUPLICATE_ID;
        }
    };
    this.remove = function (socket) {
        var name = socketToNameMap[socket.id];
        conf.agentDisconnected && conf.agentDisconnected(connectedSockets[name]);
        delete connectedSockets[name];
        delete socketToNameMap[socket.id];
    };
    this.load = function (socket) {
        if (!socket) {
            return
        }

        if (typeof socket == 'string' && connectedSockets[socket]) {
            return connectedSockets[socket];
        }

        if (socket.name && connectedSockets[socket.name]) {
            return connectedSockets[socket.name];
        }

        return connectedSockets[socketToNameMap[socket.id]];
    };
    this.loadAll = function () {
        return connectedSockets;
    };
};

module.exports = AgentCache;

function getNextName(format, lastName, minimumDigits) {

    var currNumber = lastName && parseInt(lastName.replace(/[^\d]*(\d+).*/, '$1')) || 0;
    return format.replace(/#+/, function () {
        var str = (currNumber + 1).toString();
        while (str.length < minimumDigits) {
            str = '0' + str;
        }

        return str
    })
}
