'use strict';

var AgentServer = require('../server');

// Server
var serverInstance = new AgentServer({
    protocol: AgentServer.WSS,
    port: 7788,
    secret: "my secure shared secret"
});

serverInstance.onTunnel('someCommand', function (message, agent) {
    console.log("someCommand handler has run!", message || '', agent.id || agent.ip);
    return Promise.resolve({received: 'message'});
});

serverInstance.onTunnel(function (event, message, agent) {
    // event = someCommand
    return message
});

serverInstance.onTunnel({
    someCommand: function (message, agent) {
    }
});

serverInstance.onTunnel({
    otherCommand: function (message) {
        console.log("Received otherCommand!", message);
        throw {msg: "My error message"};
    }
});


serverInstance.on('agentConnected', function (agent) {
    console.log("USER: Agent connected", agent.id);

    serverInstance
        .command(agent, 'serverCommand', {msg: 'start doing something'})
        .then(function (message) {
            console.log("agent responded with", message);
        })
        .catch(function (err) {
            console.log("agent responded with error", err);
        })
});

serverInstance.on('agentDisconnected', function (agent) {
    console.log("USER: Agent connected", agent.id)
});

serverInstance.on('error', function (err) {
    console.error("serverInstance error", err)
});


// Client
var Agent = require('../client');

var conf = Promise.resolve({
    secret: "my secure shared secret"
});

Agent
    //.logLevel(5)
    .conf(conf)
    .connect('http://localhost:7788')
    .on('ready', function () {
        console.log("Agent is ready! (verified with main)");
        Agent
            .tunnel('someCommand', {hello: 'world'})
            .then(function (res) {
                console.log('client tunnel res:', res)
            })
            .catch(function (err) {
                if (err == Agent.TIMEOUT) {
                    console.error('client tunnel timeout', err, Agent.TIMEOUT);
                }
                else {
                    console.error('client tunnel error:', err);
                }
            });
    });

Agent.onCommand(function (command, message) {
    console.log("Responding to a %s command from the server", command, message);
    return {ok: true};
});

Agent.on('error', function (err) {
    console.error("Agent error!", err);
});

Agent.on('confUpdate', function (conf) {
    console.error("Agent confUpdate!", conf);
});
