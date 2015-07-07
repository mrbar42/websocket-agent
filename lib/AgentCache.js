'use strict';

var Log = require('../utils/Log');
var utils = require('../utils/utils');
var E = require('./errors');

var AgentCache = function () {
    var connectedAgents = {};
    var socketToAgentMap = {};
    var unnamedAgents = {};

    this.save = function (newAgent) {
        var socketId = '_sid_' + newAgent.socket.id;
        var mappedId = socketToAgentMap[socketId];
        newAgent.conf = newAgent.conf || {};
        var agentId = newAgent.conf.id;
        var agent;
        if (agentId) {
            if (unnamedAgents[socketId]) {
                Log.v("AgentCache: Found as unnamed. moving to connected", agentId);
                // socket exists on unnamedAgents - move to connected
                agent = unnamedAgents[socketId];
                connectedAgents[agentId] = mergeAgents(agent, newAgent);
                socketToAgentMap[socketId] = agentId;
                delete unnamedAgents[socketId];
            }
            else {
                if (!mappedId) {
                    // unknown socket. create a new one
                    if (connectedAgents[agentId]) {
                        Log.v("AgentCache: duplicate. id already cached as different socket", agentId);
                        throw E.DUPLICATE_ID;
                    }
                    else {
                        Log.v("AgentCache: Not found. adding to cache", agentId);
                    }
                    agent = newAgent;
                    connectedAgents[agentId] = agent;
                    socketToAgentMap[socketId] = agentId;
                }
                else if (connectedAgents[mappedId]) {
                    // currently mapped as mappedId
                    if (mappedId === agentId) {
                        // matches the old id
                        Log.v("AgentCache: Found. updating conf", agentId);
                        agent = connectedAgents[mappedId];
                        connectedAgents[agentId] = mergeAgents(agent, newAgent);
                    }
                    else {
                        // id has changed
                        Log.v("AgentCache: Found. changing id  %s -> %s", mappedId, agentId);
                        agent = connectedAgents[mappedId];
                        connectedAgents[agentId] = mergeAgents(agent, newAgent);
                        socketToAgentMap[socketId] = agentId;
                        delete connectedAgents[mappedId];
                    }
                }
                else {
                    Log.d("AgentCache: Socket is mapped but wasn't found. re-creating.", agentId);
                    agent = newAgent;
                    connectedAgents[agentId] = agent;
                    socketToAgentMap[socketId] = agentId;
                }
            }

            agent.id = agentId;
        }
        else {
            // no id was provided
            if (unnamedAgents[socketId]) {
                // socket exists in unnamedAgents
                agent = unnamedAgents[socketId];
                unnamedAgents[socketId] = mergeAgents(agent, newAgent);
            }
            else if (mappedId) {
                if (connectedAgents[mappedId]) {
                    Log.d("AgentCache: Found. moving  %s -> unnamed", mappedId);
                    agent = connectedAgents[mappedId];
                    unnamedAgents[socketId] = mergeAgents(agent, newAgent);
                    delete connectedAgents[mappedId];
                    delete socketToAgentMap[socketId];
                }
                else {
                    Log.d("AgentCache: Socket is mapped but wasn't found. re-creating as unnamed.", socketId);
                    agent = newAgent;
                    unnamedAgents[socketId] = agent;
                    delete socketToAgentMap[socketId];
                }
            }
            else {
                Log.d("AgentCache: Not found. adding new unnamed socket.", socketId);
                agent = newAgent;
                unnamedAgents[socketId] = agent;
            }

            agent.id = 'Unnamed_' + newAgent.socket.id;
        }

        agent._isAgent = true;

        return agent
    };

    this.get = function (socket) {
        var socketId;
        var agentId;
        var mappedId;
        if (typeof socket == 'string') {
            socketId = '_sid_' + socket;
            agentId = socket;
        }
        else {
            socketId = '_sid_' + socket.id;
            mappedId = socketToAgentMap[socketId];
        }

        if (unnamedAgents[socketId]) {
            return unnamedAgents[socketId]
        }
        else if (mappedId && connectedAgents[mappedId]) {
            return connectedAgents[mappedId]
        }
        else if (agentId && connectedAgents[agentId]) {
            return connectedAgents[agentId]
        }
    };
    this.getAll = function () {
        return {
            agents: connectedAgents,
            unnamed: unnamedAgents
        }
    };
    this.remove = function (socket) {
        var found = false;
        var socketId = '_sid_' + socket.id;
        var mappedId = socketToAgentMap[socketId];
        if (unnamedAgents[socketId]) {
            delete unnamedAgents[socketId];
            found = true;
        }
        else if (mappedId) {
            if (connectedAgents[mappedId]) {
                delete connectedAgents[mappedId]
            }
            delete socketToAgentMap[socketId];
            found = true;
        }
        return found;
    };
};

module.exports = AgentCache;

function mergeAgents(base, newAgent) {
    Object.keys(newAgent).forEach(function (key) {
        if (newAgent[key] === undefined) return;

        switch (key) {
            case 'socket':
                base[key] = newAgent[key];
                break;
            default:
                if (newAgent[key] && typeof newAgent[key] == 'object') {
                    if (base[key] && typeof base[key] == 'object') {
                        base[key] = utils.merge(base[key], newAgent[key]);
                    }
                    else {
                        base[key] = newAgent[key];
                    }
                }
                else {
                    base[key] = newAgent[key];
                }
                break;
        }
    });

    return base
}
