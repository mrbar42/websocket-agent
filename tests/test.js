'use strict';

var AgentServer = require('../server');

// Server
var AgentGateway = new AgentServer({
    protocol: AgentServer.WS,
    port: 7788,
    secret: "my secure shared secret",
    debug: true
});

AgentGateway.onTunnel('someCommand', function (message) {
    console.log("someCommand handler has run!", message);
    return Promise.resolve({received: 'message'});
});

AgentGateway.onTunnel(function (event, message) {
    // event = someCommand
    return message
});

AgentGateway.onTunnel({
    someCommand: function (message) {
    }
});

AgentGateway.onTunnel({
    otherCommand: function (message) {
        console.log("Received otherCommand!", message);
        throw {msg: "My error message"}
    }
});


// Client
var Agent = require('../client');

var conf = Promise.resolve({
    secret: "my secure shared secret"
});

Agent
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

Agent.on('error', function (err) {
    console.error("Agent error!", err);
});

