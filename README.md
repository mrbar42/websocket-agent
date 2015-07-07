# WebSocket-Agent

WebSocket-agent is a server to server secured communication tunnel based on socket.io websocket.
It allows seamless messaging using Promise semantics and syntax.

install:
```npm install websocket-agent --save```


## Quick example

The module contain both server constructor and client

### Server
```javascript
var AgentServer = require('websocket-agent/server');

// Server
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
#### AgentServer#onTunnel

Respond to tunnel action from an Agent.

- action specific handler
``` AgentServer#onTunnel({string} action, {function} handler(message, agent)) ```
- multiple actions
``` AgentServer#onTunnel({object} actions)  {"action": {function} handler} ```
- catch all (receives action as first argument)
``` AgentServer#onTunnel({function} catchAllHandler(action, message, agent)) ```


The handler follows Promise syntax and sends the eventual return value to the client
Throwing error  will stop message processing and will trigger the ```catch``` handler on client side

Call ```onTunnel``` as many times as you need.
In case of multiple handlers for one command, they will run by declaration order

note: if a generic catch all handler is defined, it will run before any action specific handlers regardless to declaration order


Example:
```javascript
// catch all syntax
serverInstance.onTunnel(function (action, message, agent) {
    if (action == 'someCommand') {
        return Promise.resolve({})
    }
})

// same as
serverInstance.onTunnel('someCommand', function (message, agent) {
    return Promise.resolve({})
})

// same as
serverInstance.onTunnel({
    'someCommand': function (message, agent) {
        return Promise.resolve({})
    }
})
```

returns `AgentServer`

 
#### AgentServer#command

` Agent.command({object|string} agent, {string} command [, {*} message]) `

Send command to the given Agent

Example:
```javascript
serverInstance.on('agentConnected', function (agent) {
    serverInstance
        .command(agent, 'myAction', {attached: "payload"})
        .then(function (response) {
        
        })
        .catch(function (err) {
        
        })
})

// or use agentId
serverInstance
    .command('A0001', 'myAction', {attached: "payload"})
    .then(function (response) {
    
    })
    .catch(function (err) {
    })

```

Command errors:  
- TIMEOUT - message timeout (the Agent may have received the message)
- UNKNOWN_ACTION - the Agent doesn't have any handlers for the given action
- UNKNOWN_AGENT - the Agent doesn't have any handlers for the given action
- AGENT_NOT_CONNECTED - the Agent doesn't have any handlers for the given action


#### AgentServer#commandAll

` Agent.commandAll({string} command [, {*} message]) `

Send command to all of the connected Agents

Example:
```javascript
serverInstance
    .commandAll('healthCheck', {attached: "payload"})
    .then(function (responses) {
        // responses = {
        // A0001: {}, // response from agent id A0001
        // A0002: {}
        // }
    })
    .catch(function (err) {
        // at least one failed with
    })
```

CommandAll errors:
- All errors from ` AgentServer#command `
- NO_CONNECTED_AGENTS - message timeout (the Agent may have received the message)



### server events
 - ```agentConnected``` - emitted whenever an agent is connected and verified. socket is the payload
 - ```agentDisconnected``` - emitted whenever an agent is disconnected. socket is the payload


## Agent (client class)

```javascript
var Agent = require('websocket-agent/client');
 
```

#### Agent#conf

``` Agent.conf({object|function|Promise|null} conf) ```

conf method will accept object, function that returns object/promise or a promise that resolves to an object.
the entire conf object will be sent to the server on the validation process.
- ```conf.secret``` - shared key between the server and the clients. used to encrypt a validation token for each message.
- ```conf.id``` -  a unique identifier for this server (duplicates are rejected). available through `serverInstance.connectedAgents[id]`

* note - Do not use complex object nesting. when updating conf remotely, nested objects changes will be overwritten in the merging process

returns `Client` object

#### Agent#connect

``` Agent.connect({string} serverUrl) ```

the url of the server in socket.io schema

Example:
```javascript
Agent.connect('http://example.com:8080')

```
returns the `Client` object

#### Agent#tunnel

``` Agent.tunnel({string} action [,{object} message [, {number} timeout]]) ```

Send a tunnel request in Promise syntax

Example:
```javascript
Agent
    .tunnel('someCommand', {hello: 'world'}, 10000)
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

Tunnel errors:
- NOT_READY - happens when trying to send tunnel before ` Agent ` emitted ` 'ready' ` event 
- OFFLINE - happens when trying to send tunnel and agent is offline 
- TIMEOUT - message timeout (the server may have received the message)
- UNKNOWN_ACTION - the server doesn't have any handlers for the given action
 
#### Agent events
 - ` connected` - emitted once when the socket connects to the server 
 - ` disconnected` - emitted every time the connection to the server is disconnected
 - ` reconnected`- emitted every time the socket had reconnected after disconnecting
 - ` ready` - emitted once a connection to the server has been established and a validation message successfully traveled to the server and back
 - ` authorized` - emitted every time the client authorizes itself with the server - its the client parallel of server's `agentAuthorized` 
 - ` confLoaded` - emitted every time conf has been loaded successfully (after calling .conf method) 


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


# TODO

- improve commandAll handling of each Agent response
