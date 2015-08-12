'use strict';

var AgentServer = require('../server');

var fs = require('fs');
var FileStore = function (conf) {
    conf = conf || {};
    return {
        save: function (doc) {
            return new Promise(function (resolve, reject) {
                fs.writeFile(conf.file || 'fileStore.json', JSON.stringify(doc, null, 4), {flag: 'w+'}, function (err) {
                    if (err) {
                        console.error(err);
                        return reject()
                    }
                    resolve()
                })
            });
        },
        load: function () {
            return new Promise(function (resolve, reject) {
                fs.readFile(conf.file || 'fileStore.json', {encoding: 'utf8'}, function (err, content) {
                    if (err && err.code != 'ENOENT') {
                        console.error(err);
                        return reject();
                    }
                    resolve(content && JSON.parse(content));
                })
            });
        }
    }
};

// Server
var serverInstance = new AgentServer({
    protocol: AgentServer.WS,
    port: 7788,
    secret: "my secure shared secret",
    agentNameFormat: 'A####',
    dataStore: FileStore({file: 'serverStore.json'})
});


serverInstance.on('agentConnected', function (agent) {
    console.log("Agent connected", agent.name);
    setTimeout(function () {
        serverInstance
            .sendTo(agent, 'someEventFromServer', {welcome: true})
            .then(console.log.bind(console))
            .catch(console.error.bind(console))
    }, 1000);
});

serverInstance.onHook('someEvent', function (message, socket, agent) {
    console.log("Agent %s sent message", agent.name, message);

    return Promise.resolve("home run");
});


// Client
var Agent = require('../client');

var agent = new Agent({
    host: 'http://localhost:7788',
    secret: "my secure shared secret",
    dataStore: FileStore({file: 'clientStore.json'})
});

agent.onHook('someEventFromServer', function (message, socket) {
    // return something to the server
    if (!message) {
        throw "No message was provided";
    }

    return {ok: 1}
});

agent.on('ready', function () {
    console.log("agent is ready");
    agent
        .send("someEvent", {})
        .then(function (response) {
            console.log('client tunnel res:', response);
        })
        .catch(function (err) {
            if (err == Agent.TIMEOUT) {
                console.error('client tunnel timeout', err, Agent.TIMEOUT);
            }
            else {
                console.error('client tunnel error:', err);
            }
        })
})
    .on('error', function (err) {
        console.error("Client error", err);
    });