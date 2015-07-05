# WebSocket-Agent

WebSocket-agent is a server to server secured communication tunnel based on socket.io websocket.
It allows seamless messaging using Promise semantics.

install:
`npm install websocket-agent --save`


## Quick example

The module contain both server constructor and client

### Server
```javascript
var AgentServer = require('websocket-agent/server');

// Server
var AgentGateway = new AgentServer({
    protocol: AgentServer.WS,
    port: 7788,
    secret: "my secure shared secret",
    debug: false
});

AgentGateway.onTunnel('someCommand', function (message) {
    console.log("Received someCommand!", message);
    
    // some async promise
    return Promise.resolve({message: 'acknowledged'});
    // can also throw error
    // throw {error}
});

AgentGateway.onTunnel({
    otherCommand: function (message) {
        console.log("Received otherCommand!", message);
        throw {msg: "My error message"}
    }
});
```

### Client
```javascript
var Agent = require('websocket-agent/client');

// Client
var Agent = require('./client');

// conf can be loaded asynchronously
var conf = Promise.resolve({
    secret: "my secure shared secret"
});


Agent
    .conf(conf)
    .connect('http://localhost:7788')
    .on('ready', function () {
        console.log("Agent is ready! (connected and verified with master)");
        
        Agent
            .tunnel('someCommand', {hello: 'world'}, 10000) // optional timeout in ms
            .then(function (response) {
                console.log('Server responded to someCommand with:', response)
            })
            .catch(function (err) {
                if (err == Agent.TIMEOUT) {
                    console.error('Tunnel message timeout');
                }
                else {
                    console.error('Server returned err', err);
                }
            });
    })
    
Agent.on('error', function (err) {
    console.error("Agent error!", err);
})
```
## events

Both server object and client objects are instances of EventEmitter

### server events
 - `agentConnected`
 
 
### client events
 - `connected` - emitted once when the socket connects to the server 
 - `disconnected` - emitted every time the connection to the server is disconnected
 - `reconnected`- emitted every time the socket had reconnected after disconneting
 - `ready` - emitted once a connection to the server has been established and a validation message successfully traveled to the server and back
 - `authorized` - emitted every time the client authorizes itself with the server - its the client parallel of server's `agentAuthorized` 
 - `confLoaded` - emitted every time conf has been loaded successfully (after calling .conf method)


## TODO

- add connecting agent identity to tunnel messages
