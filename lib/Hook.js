'use strict';

var Log = require('../utils/Log');
var middleware = require('./middleware');

var Hook = function (hookEvent, _secret) {
    var _this = this;
    var _cache = {};
    var _defaultTimeout = 15e3;
    var _hookHandlers = {};
    var _genericHookHandler = [];

    this.hookEvent = hookEvent;

    this.TIMEOUT = 'TIMEOUT';
    this.INVALID_MESSAGE = 'INVALID_MESSAGE';
    this.NO_HANDLERS = 'NO_HANDLERS';
    this.INTERNAL_ERROR = 'INTERNAL_ERROR';

    if (!_secret) {
        Log.w("You must provide a secret string")
    }


    this.send = function (socket, action, body, timeout) {
        var rand;
        while (!rand) {
            var temp = Math.random().toString(36).substr(2);
            if (!_cache[rand]) {
                rand = temp;
            }
        }
        var cache = _cache[rand] = {active: true};

        return new Promise(function (resolve, reject) {
            cache.resolve = function (data) {
                if (cache.active) {
                    cache.active = false;
                    clearTimeout(cache.timer);
                    delete _cache[rand];
                    resolve(data)
                }
            };
            cache.reject = function (err) {
                if (cache.active) {
                    cache.active = false;
                    clearTimeout(cache.timer);
                    delete _cache[rand];
                    reject(err)
                }
            };
            cache.active = true;

            if (timeout !== 0) {
                cache.timer = setTimeout(function () {
                    cache.active && cache.reject(_this.TIMEOUT);
                }, timeout || _defaultTimeout);
            }

            var message = {
                rand: rand,
                action: action,
                body: body
            };


            message = middleware.signMessage(message, _secret);

            socket.emit(hookEvent, message);
        });
    };

    // handle response to our own hook
    this.onHookResponse = function (message) {
        var rand = message && message.rand;
        if (!rand) {
            Log.d("no rand provided. ignoring message", message);
            return
        }
        if (!_cache[rand]) {
            Log.d("rand wasn't found - probably an old message");
            return
        }

        var cache = _cache[rand];
        if (cache.active) {
            if (message.error) {
                cache.reject(message.error);
            }
            else {
                cache.resolve(message.body);
            }
        }
    };

    // hook from the remote side
    this.onRemoteHook = function () {
        var args = Array.prototype.slice.call(arguments);
        var socket = args.shift();
        var message = args.shift();
        args.unshift(message.body);

        var rand = message && message.rand;

        return Promise.resolve()
            .then(function () {
                if (message && message.isInvalid) {
                    Log.d("Received invalid message");
                    throw _this.INVALID_MESSAGE;
                }
                if (!message) {
                    Log.d("Received message without payload. ignoring message");
                    throw _this.INVALID_MESSAGE;
                }

                if (!rand) {
                    Log.d("Received message without rand. ignoring message", message);
                    throw _this.INVALID_MESSAGE;
                }

                var action = message.action;
                if (!action) {
                    Log.d("Received message without action. returning error", message);
                    throw _this.INVALID_MESSAGE;
                }

                var promise = Promise.resolve(message.body);

                if (!_hookHandlers[action] && !_genericHookHandler.length) {
                    Log.w("No handler was registered for '%s' action. ignoring message", action);
                    throw _this.NO_HANDLERS
                }

                var userResponse;

                if (_genericHookHandler.length) {
                    promise = promise.then(function () {
                        var chain = Promise.resolve();
                        var argsArray = [action].concat(args);
                        _genericHookHandler.forEach(function (handler) {
                            chain = chain.then(function () {
                                return handler.apply(null, argsArray);
                            })
                                .then(function (result) {
                                    if (result) {
                                        userResponse = result
                                    }
                                })
                        });

                        return chain;
                    });
                }
                if (_hookHandlers[action]) {
                    promise = promise.then(function () {
                        var chain = Promise.resolve();
                        _hookHandlers[action].forEach(function (handler) {
                            chain = chain.then(function () {
                                return handler.apply(null, args);
                            })
                                .then(function (result) {
                                    if (result) {
                                        userResponse = result
                                    }
                                })
                        });

                        return chain;
                    });
                }

                return promise
                    .then(function (result) {
                        return {
                            body: userResponse || result
                        };
                    });
            })
            .catch(function (err) {
                var error = err;
                if (err instanceof Error) {
                    error = _this.INTERNAL_ERROR;
                    Log.e("Error while processing RemoteHook: \n" + (err.stack || err.message || err));
                }
                else {
                    Log.e("Error processing RemoteHook", err);
                }

                return {error: error};
            })
            .then(function (response) {
                if (rand) {
                    response.rand = rand;
                    response = middleware.signMessage(response, _secret);

                    Log.d("Sending back!", response);
                    socket.emit(hookEvent + ':response', response);
                }
            })
    };

    this.onRemoteHello = function () {
        var args = Array.prototype.slice.call(arguments);
        var socket = args.shift();
        var message = args.shift();

        var rand = message && message.rand;

        var promise = Promise.resolve({body: {}});

        if (message.isInvalid) {
            promise = promise.then(function () {
                throw _this.INVALID_MESSAGE;
            })
        }

        return promise
            .catch(function (err) {
                var error = err;
                if (err instanceof Error) {
                    error = _this.INTERNAL_ERROR;
                    Log.e("Error while processing RemoteHook: \n" + (err.stack || err.message || err));
                }
                else {
                    Log.e("Error processing RemoteHook", err);
                }

                return {error: error};
            })
            .then(function (response) {
                if (rand) {
                    response.rand = rand;
                    response = middleware.signMessage(response, _secret);

                    Log.d("Sending back!", response);
                    socket.emit(hookEvent + ':response', response);
                }
            })
    };

    this.on = function (action, handler) {

        switch (action && typeof action) {
            case 'function':
                _genericHookHandler.push(action);
                break;
            case 'string':
                if (!handler || typeof handler != 'function') {
                    Log.w("An handler is must be provided when calling 'on' method. ({string} action, {function} handler)");
                    break
                }

                if (!_hookHandlers[action]) {
                    _hookHandlers[action] = [];
                }

                Log.v("adding action handler for %s", action);
                _hookHandlers[action].push(handler);
                break;
            case 'object':
                Object.keys(action).forEach(function (key) {
                    if (!action[key] || typeof action[key] != 'function') {
                        Log.w("An handler is must be provided for each action when calling 'on method'. ({string} action, {function} handler)");
                        return
                    }

                    if (!_hookHandlers[key]) {
                        _hookHandlers[key] = [];
                    }
                    Log.v("adding action handler for %s", key);
                    _hookHandlers[key].push(action[key]);
                });

                break;
            default:
                Log.w("Called 'commands' property with invalid argument [%s] %s", typeof action, action);
                break;

                return this
        }
    }
};

module.exports = Hook;
