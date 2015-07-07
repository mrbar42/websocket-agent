'use strict';

var Log = require('../utils/Log');
Log.logLevel = Log.VERBOSE;

// simulate socket
var EventEmitter = require('events').EventEmitter;
var socket = new EventEmitter();

var Hook = require('../lib/Hook');

var hook = new Hook('_hook', socket, "asdfghjkl;'");

// respond to remote hook
socket.on('_hook', function (message) {
    Log("Received hook", message);
    hook.onRemoteHook(message, "test")
});

socket.on('_hook:response', function (message) {
    Log("Received hook:response", message);
    hook.onHookResponse(message);
});

hook.on('someAction', function (event, message, test) {
    return {hook: 'response'}
});


hook
    .send('someAction', {payload: 'data'})
    .then(function (message) {
        console.log("Success!", message)
    })
    .catch(function (err) {
        console.log("Error!", err)
    });


