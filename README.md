# WebSocket-Agent

[![NPM](https://nodei.co/npm/websocket-agent.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/websocket-agent/)


WebSocket-agent is a server to server secured communication tunnel based on socket.io websocket.
It allows seamless messaging using Promise semantics and syntax.

install:
```javascript npm install websocket-agent --save ```


## Quick example

The module contain both server constructor and client

### Server
```javascript
var AgentServer = require('websocket-agent/server');

var serverInstance = new AgentServer({
    protocol: AgentServer.WS,
    port: 7788,
    secret: "my secure shared secret"
});

serverInstance.onTunnel('someCommand', function (message) {
    console.log("Received someCommand!", message);
    // return value or promise
    return Promise.resolve({message: 'received'});
});

serverInstance.onTunnel({
    otherCommand: function (message) {
        console.log("Received otherCommand!", message);
        throw {code: "MYERRCODE", msg: "My error message"}
    }
});
```

### Client
```javascript
var Agent = require('websocket-agent/client');


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
                console.log('Server responded to someCommand with:', response) // equals {message: 'received'}
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

# Documentation

## Usage

The module returns two objects - client and server, though there is no reason to require them both.

*note: the module doesn't use any Promise library and count on the basic Promise global object.
        If you use and old node/iojs version either use a polyfill or upgrade your engine

```javascript
var websocket-agent = require('websocket-agent');
// server object
var AgentServer = websocket.AgentServer;
// client object
var Agent = websocket.Agent;


// or require directly
var AgentServer = require('websocket-agent/server');
var Agent = require('websocket-agent/client');
```

## AgentServer (server constructor)

start a server instance that starts to listen immediately

Options:
- ` secret ` - {string} secret key to validate incoming messages (required)
- ` port ` - {number} websocket port. default: ws:80, wss:443
- ` protocol ` - websocket protocol. default: ws
- ` wssOptions ` - (wss only) {object} additional options to pass to the ` https.createServer ` method
- ` privateKey ` - (wss only) {string|Buffer} added to wssOptions
- ` certificate ` - (wss only) {string|Buffer} added to wssOptions
- ` agentNameFormat ` - {string} agents naming format - use `#` to indicate an auto incremented digit. multiple `#` will be filled with 0. `A###` - > `A001`
- ` debug ` - {boolean} be verbose (don't do it to yourself). default: false

```javascript
var AgentServer = require('websocket-agent/server');

// plain ws
var serverInstance = new AgentServer({
    protocol: AgentServer.WS,
    port: 7788,
    secret: "my secure shared secret"
});

var fs = require('fs')

// secured wss
var serverInstance = new AgentServer({
    protocol: AgentServer.WSS,
    secret: "my secure shared secret",
    port: 7788,
    privateKey: fs.readFileSync('key.pem'),
    certificate: fs.readFileSync('cert.pem')
});
 
```
#### AgentServer#on

Respond to tunnel action from an Agent.

- action specific handler
``` AgentServer#on({string} action, {function} handler(message, agent)) ```
- multiple actions
``` AgentServer#on({object} actions)  {"action": {function} handler} ```
- catch all (receives action as first argument)
``` AgentServer#on({function} catchAllHandler(action, message, agent)) ```


The handler follows Promise syntax and sends the eventual return value to the client
Throwing error  will stop message processing and will trigger the ```catch``` handler on client side

Call ```on``` as many times as you need.
In case of multiple handlers for one command, they will run by declaration order

note: if a generic catch all handler is defined, it will run before any action specific handlers regardless to declaration order


Example:
```javascript
// catch all syntax
serverInstance.on(function (action, message, agent) {
    if (action == 'someCommand') {
        return Promise.resolve({})
    }
})

// same as
serverInstance.on('someCommand', function (message, agent) {
    return Promise.resolve({})
})

// same as
serverInstance.on({
    'someCommand': function (message, agent) {
        return Promise.resolve({})
    }
})
```

 
#### AgentServer#sendTo

` Agent.sendTo({object|string} agent, {string} command [, {*} message]) `

Send command to the given Agent

Example:
```javascript
serverInstance.on('agentConnected', function (agent) {
    serverInstance
        .sendTo(agent, 'myAction', {attached: "payload"})
        .then(function (response) {
        
        })
        .catch(function (err) {
        
        })
})

// or use agentName
serverInstance
    .sendTo('A0001', 'myAction', {attached: "payload"})
    .then(function (response) {
    
    })
    .catch(function (err) {
    })

```

sendTo errors:
- TIMEOUT - message timeout (the Agent may have received the message)
- UNKNOWN_ACTION - the Agent doesn't have any handlers for the given action
- UNKNOWN_AGENT - the Agent doesn't have any handlers for the given action
- AGENT_NOT_CONNECTED - the Agent doesn't have any handlers for the given action


#### AgentServer#sendAll

` Agent.sendAll({string} command [, {*} message]) `

Send command to all of the connected Agents

Example:
```javascript
serverInstance
    .sendAll('healthCheck', {attached: "payload"})
    .then(function (responses) {
        // responses = {
        // A0001: {}, // response from agent name A0001
        // A0002: {}
        // }
    })
    .catch(function (err) {
        // at least one failed with
    })
```

sendAll errors:
- All errors from ` AgentServer#command `
- NO_CONNECTED_AGENTS - message timeout (the Agent may have received the message)


### server events
 - ```agentConnected``` - emitted whenever an agent is connected and verified. agent object is the payload
 - ```agentDisconnected``` - emitted whenever an agent is disconnected.  agent object is the payload


## Agent (client constructor)

Create a client instance

Options:
- ` host ` - {string} socket.io host to connect to (required).
- ` secret ` - {string} secret key to validate incoming messages (required)
- ` dataStore ` - {object} data store for persistent data. (see DataStores section bellow)
- ` debug ` - {boolean} be verbose (don't do it to yourself). default: false

```javascript
var Agent = require('websocket-agent/client');

var agent = new Agent({
    host: 'http://localhost:7788',
    secret: "my secure shared secret",
    dataStore: FileStore({file: 'clientStore.json'})
})

agent.on('ready', function () {})

```

#### Agent#send

``` Agent.send({string} action [,{object} message [, {number} timeout]]) ```

Send an event request in Promise syntax

Example:
```javascript
Agent
    .send('someCommand', {hello: 'world'}, 10000)
    .then(function (message) {
        // server response message
    })
    .catch(function (err) {
        if (err === Agent.TIMEOUT) {
            // request timed out
            // if server responds after timeout fired, the response will be ignored 
        }
        else {
            // server threw err
        }
    })

```

send errors:
- NOT_READY - happens when trying to send tunnel before ` Agent ` emitted ` 'ready' ` event 
- OFFLINE - happens when trying to send tunnel and agent is offline 
- TIMEOUT - message timeout (the server may have received the message)
- UNKNOWN_ACTION - the server doesn't have any handlers for the given action
 
#### Agent events
 - ` connected` - emitted once when the socket connects to the server 
 - ` disconnected` - emitted every time the connection to the server is disconnected
 - ` reconnected`- emitted every time the socket had reconnected after disconnecting
 - ` ready` - emitted once a connection to the server has been established and a validation message successfully traveled to the server and back


## Error handling

Server:
```javascript
serverInstance.on('error', function (err) {
    console.error(err)
}) ```

General Errors:
- WRONG_SECRET - the provided secret does not match the secret on the server
- DUPLICATE_ID - two agents with the same id tried to connect to the server (only the first one is accepted)

Client:
 ```javascript
Agent.on('error', function (err) {
    switch () {
    case Agent.WRONG_SECRET:
        default:
    case Agent.DUPLICATE_ID:
            default:
    case Agent.WRONG_SECRET:
            default:
        console.error(err)
        break
    }
})
```

## Data Stores

Enable data store to save persistent client names.
data stores must be an object with two methods `save` and `load` that returns a promise
You can use any backend that you want

here is a simple example for a json file storage:

```javascript
var fs = require('fs');

var FileStore = function (conf) {
    conf = conf || {};
    return {
        save: function (doc) {
            return new Promise(function (resolve, reject) {
                fs.writeFile(conf.file || 'fileStore.json', JSON.stringify(doc), {flag: 'w+'}, function (err) {
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
                fs.readFile(conf.file || 'fileStore.json', {encoding: 'utf8', flags: 'a+'}, function (err, content) {
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

# Server
var serverInstance = new AgentServer({
    port: 7788,
    secret: "my secure shared secret",
    agentNameFormat: 'A####',
    dataStore: FileStore({file: 'serverStore.json'})
});

# Client
var agent = new Agent({
    host: 'http://localhost:7788',
    secret: "my secure shared secret",
    dataStore: FileStore({file: 'clientStore.json'})
});
```



