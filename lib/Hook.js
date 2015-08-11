/**
 * version:    0.0.5
 * Repo:       https://github.com/mrbar42/Hook
 * License:    MIT
 * @license
 */
(function (global) {
    'use strict';

    /**
     * Creates Bi-directional event emitting hook
     *
     * @param {string} [hookEvent='_hook'] - event name to base on
     * @constructor
     */
    var Hook = function (hookEvent) {
        var _this = Object.create(null);
        var _cache = {};
        var _defaultTimeout = 6e4;
        var _hookHandlers = {};
        var _genericHookHandler = [];
        var _helloHandler;
        var _hookValidator;
        var _bindSocket;

        /** Event Names */
        var BASE = hookEvent || '_hook';
        var HOOK_REQUEST = BASE + ':request';
        var HOOK_RESPONSE = BASE + ':response';
        var HELLO_REQUEST = BASE + ':hello:request';
        var HELLO_RESPONSE = BASE + ':hello:response';

        /** Constants */
        _this.TIMEOUT = 'TIMEOUT';
        _this.INVALID_MESSAGE = 'INVALID_MESSAGE';
        _this.NO_HANDLERS = 'NO_HANDLERS';
        _this.NO_SOCKET_BIND = 'NO_SOCKET_BIND';
        _this.INTERNAL_ERROR = 'INTERNAL_ERROR';

        /** Private functions */
        var onHookResponse = function (message) {
            var rand = message && message.rand;
            if (!rand) {

                return
            }
            if (!_cache[rand]) {

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
        var onRemoteHook = function (socket, message) {
            var rand = message && message.rand;

            return Promise.resolve()
                .then(function () {
                    if (!message) {
                        throw _this.INVALID_MESSAGE;
                    }

                    if (!rand) {
                        throw _this.INVALID_MESSAGE;
                    }

                    var action = message.action;
                    if (!action) {
                        throw _this.INVALID_MESSAGE;
                    }

                    var promise = Promise.resolve(message.body);

                    if (!_hookHandlers[action] && !_genericHookHandler.length) {
                        console.warn("No handler was registered for '%s' action. ignoring message", action);
                        throw _this.NO_HANDLERS
                    }

                    var args = [message.body, socket];
                    if (_hookValidator) {
                        promise = promise.then(function (body) {
                            return new Promise(function (resolve, reject) {
                                try {
                                    var retVal = _hookValidator(action, body, socket);
                                    Promise
                                        .resolve(retVal)
                                        .then(function (extraArgs) {
                                            if (extraArgs !== undefined) {
                                                args = args.concat(extraArgs);
                                            }
                                            resolve()
                                        })
                                        .catch(reject);
                                } catch (err) {
                                    reject(err)
                                }
                            });
                        });
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
                        console.error("Error while processing RemoteHook: \n" + (err.stack || err.message || err));
                    }

                    return {error: error};
                })
                .then(function (response) {
                    if (rand) {
                        response.rand = rand;
                        socket.emit(HOOK_RESPONSE, response);
                    }
                })
        };
        var onRemoteHello = function (socket, message) {
            var args = Array.prototype.slice.call(arguments);
            socket = args.shift();
            message = args.shift();

            var rand = message && message.rand;

            var promise = Promise.resolve({body: {}});

            promise = promise
                .then(function () {
                    if (!_helloHandler) {
                        throw _this.NO_HANDLERS;
                    }

                    return _helloHandler(message.body, socket)
                });

            return promise
                .then(function (body) {
                    return {body: body}
                })
                .catch(function (err) {
                    var error = err;
                    if (err instanceof Error) {
                        error = _this.INTERNAL_ERROR;
                        console.error("Error while processing RemoteHook: \n" + (err.stack || err.message || err));
                    }

                    return {error: error};
                })
                .then(function (response) {
                    if (rand) {
                        response.rand = rand;

                        socket.emit(HOOK_RESPONSE, response);
                    }
                })
        };
        /**
         * @returns {Promise|*}
         */
        var emit = function (socket, event, action, body, timeout) {
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

                socket.emit(event, message);
            });
        };

        /**
         * Validation function for hello message
         *
         * @name Hook~onHelloHandler
         * @type {function}
         * @param {*} message - message from the remote side
         * @param {object} socket - Ref to the remote socket
         * @returns {Promise|*} - return value will be sent to remote side
         * @throws {*} - thrown data will be sent to remote side as error
         */
        /**
         * Defines a validation function for hello messages  on instance variable _helloHandler
         *
         * @param {function} handler {@link Hook~onHelloHandler}
         * @returns {Hook}
         */
        _this.onHello = function (handler) {
            if (_helloHandler) {
                console.error("called onHello more than once")
            }

            if (!handler || typeof handler != 'function') {
                console.warn("Invalid handler for 'onHello' method. must be a function. [%s]", typeof handler);
            }
            else {
                _helloHandler = handler;
            }

            return _this;
        };

        /**
         * @name Hook~onHookHandler
         * @type {function}
         * @param {string} action - message from the remote side
         * @param {*} message - message from the remote side
         * @param {object} socket - Ref to the remote socket
         * @param {function} next(...extraParameters) - callback function. accepts indefinite parameters to pass on to handlers
         * @throws {*} - throwing data will reject the message and send the remote side as error
         */
        /**
         * Defines a validation function for hello messages on instance variable _hookValidator
         *
         * @param {function} handler {@link Hook~onHookHandler}
         * @returns {Hook}
         */
        _this.onHook = function (handler) {
            if (_hookValidator) {
                console.error("called onHook more than once")
            }
            else {
                _hookValidator = handler;
            }

            return _this;
        };

        /**
         * Binds a socket to allow usage of without setting a target socket
         * Enables Hook#send and Hook#sendHello
         *
         * @param {object} socket
         */
        _this.bindSocket = function (socket) {
            if (socket && typeof socket == 'object') {
                _bindSocket = socket;
            }
            else {
                console.warn("Hook#bindSocket - Invalid socket", socket);
            }

            return _this;
        };

        /**
         * Attach hook listeners to the given socket
         *
         * @param {object} socket
         */
        _this.attach = function (socket) {
            // Hello
            // remote side sent hello request
            socket.on(HELLO_REQUEST, function (message) {
                onRemoteHello(socket, message);
            });
            // remote side answered our hello
            socket.on(HELLO_RESPONSE, onHookResponse);

            // Hook
            // remote side sent hook request
            socket.on(HOOK_REQUEST, function (message) {
                onRemoteHook(socket, message);
            });
            // remote side answered our hook
            socket.on(HOOK_RESPONSE, onHookResponse);

            return _this;
        };


        /**
         * Add handler for an action
         *
         * Possible inputs:
         * .on(action, handler(message, socket, ...extraParameters))
         * .on({action: handler(message, socket, ...extraParameters)>})
         * .on(handler(action, message, socket, ...extraParameters))
         * For extraParameters explanation see {@link Hook~onHookHandler}
         *
         * @param {string|object|function} action
         * @param {function} [handler]
         * @returns {Hook}
         */
        _this.on = function (action, handler) {
            switch (action && typeof action) {
                case 'function':

                    _genericHookHandler.push(action);
                    break;
                case 'string':
                    if (!handler || typeof handler != 'function') {
                        console.warn("An handler is must be provided when calling 'on' method. ({string} action, {function} handler)");
                        break
                    }

                    if (!_hookHandlers[action]) {
                        _hookHandlers[action] = [];
                    }


                    _hookHandlers[action].push(handler);
                    break;
                case 'object':
                    Object.keys(action).forEach(function (key) {
                        if (!action[key] || typeof action[key] != 'function') {
                            console.warn("An handler is must be provided for each action when calling 'on method'. ({string} action, {function} handler)");
                            return
                        }

                        if (!_hookHandlers[key]) {
                            _hookHandlers[key] = [];
                        }

                        _hookHandlers[key].push(action[key]);
                    });

                    break;
                default:
                    console.warn("Called 'commands' property with invalid argument [%s] %s", typeof action, action);
                    break;
            }
            return _this;
        };

        /**
         *
         * @param {object} socket - socket to send to
         * @param {string} action - action to trigger
         * @param {*} [body] - body to add along with the message
         * @param {number} [timeout] - time out in ms to wait for response
         * @returns {Promise|*} - promise that resolves on remote response or on timeout
         */
        _this.sendTo = function (socket, action, body, timeout) {
            return emit(socket, HOOK_REQUEST, action, body, timeout);
        };
        /**
         * Same as Hook#sendTo but uses the bind socket automatically
         */
        _this.send = function (action, body, timeout) {
            if (!_bindSocket) return Promise.reject(_this.NO_SOCKET_BIND);

            return emit(_bindSocket, HOOK_REQUEST, action, body, timeout);
        };

        /**
         *
         * @param {object} socket - socket to send to
         * @param {*} [body] - body to add along with the message
         * @returns {Promise|*} - promise that resolves on remote response or on timeout
         */
        _this.sendHelloTo = function (socket, body) {
            return emit(socket, HELLO_REQUEST, 'hello', body);
        };
        /**
         * Same as Hook#sendHelloTo but uses the bind socket automatically
         */
        _this.sendHello = function (body) {
            if (!_bindSocket) return Promise.reject(_this.NO_SOCKET_BIND);
            return emit(_bindSocket, HELLO_REQUEST, 'hello', body);
        };

        return _this;
    };

    if (typeof define != 'undefined' && define.amd) {
        define(function () {
            return Hook;
        });
    }
    else if (typeof exports != 'undefined') {
        if (typeof module != 'undefined' && module.exports) {
            exports = module.exports = Hook;
        }
        else {
            exports.Hook = Hook
        }
    }
    else {
        global.Hook = Hook;
    }
}).call(this, typeof global != 'undefined' ? global :
        typeof self != 'undefined' ? self :
            typeof window != 'undefined' ? window :
            this || {});