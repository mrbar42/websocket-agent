'use strict';

var AgentServer = require('../server');

var fs = require('fs');

// secured wss
var serverInstance = new AgentServer({
    protocol: AgentServer.WSS,
    secret: "my secure shared secret",
    port: 7789,
    privateKey: fs.readFileSync('ssl/server.key'),
    certificate: fs.readFileSync('ssl/server.crt')
});