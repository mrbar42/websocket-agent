'use strict';

var LOG = {
    NONE: 0,
    ERROR: 1,
    WARN: 2,
    LOG: 3,
    DEBUG: 4,
    VERBOSE: 5
};
var VERB = [
    null,
    "error",
    "warn",
    "log",
    "info",
    "info"
];
var LOG_REVERSE = [
    "NONE",
    "ERROR",
    "WARN",
    "LOG",
    "DEBUG",
    "VERBOSE"
];
var colors = [
    '0;30m',
    '0;31m',
    '1;33m',
    '1;34m',
    '0;96m',
    '0;37m'
];

var logLevel = LOG[process.env.LOG_LEVEL] || process.env.NODE_ENV == 'production' ? LOG.ERROR : LOG.DEBUG;
var defaultLevel = LOG.LOG;

/** @namespace */
var Log = function (msg) {
    var lvl;
    var code;
    var skipCallsCount = 2;
    var args = Array.prototype.slice.call(arguments);
    if (msg && msg._innerLvl) {
        // inner call - remove extra line from trace
        lvl = msg._innerLvl;
        skipCallsCount++;
        args.shift();
    }
    else if (msg && msg.lvl) {
        lvl = msg.lvl;
        delete msg.lvl;
    }

    lvl = lvl || defaultLevel;

    if (lvl == LOG.WARN) {
        skipCallsCount++;
    }
    var errorObject = new Error();
    var tempStack = errorObject.stack.match(/((?:[^\r\n]|\r(?!\n)(?:\n|$))+)/g);
    tempStack = tempStack[skipCallsCount]
                && tempStack[skipCallsCount].replace(/\s*at\s*.*(?:\/|<|\\)([^\/<]+:\d+:\d+).*/, "$1");
    var message = LOG_REVERSE[lvl] + ':';
    message += tempStack ? '\x1b[90m' + tempStack + '\x1b[0m ' : '';
    message = '\x1b[' + (colors[lvl] || '0;39m') + message + '\x1b[0m';

    var count = -1;
    while (args.length) {
        count++;
        var arg = args.shift();
        if (typeof arg == 'string') {
            if (arg.indexOf('%s') > -1) {
                while (arg.indexOf('%s') > -1) {
                    var subArg = args.shift();
                    subArg = typeof subArg == 'object' && JSON.stringify(subArg) || subArg;
                    arg = arg.replace('%s', subArg);
                }
                message += arg;
            }
            else {
                message += arg;
            }
        }
        else if (arg && typeof arg == 'object') {
            if (arg.code && !code) {
                code = arg.code;
            }

            var str;

            if (arg instanceof Error) {
                str = arg.stack;
            }
            else {
                str = JSON.stringify(arg);
                if (str.length >= 128) {
                    str = JSON.stringify(arg, null, 4);
                }
            }

            message += str;
        }
        else if (typeof arg == 'function') {
            message += (arg.name || "Anonymous function") + '-->\n'
                       + arg.toString().replace(/(^.*\n.*\n.*\n.*)(\n|.*)+/, "$1") + '\n';
        }
        else {
            message += arg;
        }
        message += ' ';
    }

    if ((lvl || defaultLevel) <= logLevel) {
        console.log(message);
    }

    return {
        message: message,
        code: code,
        _internal: true
    };
};

/** @memberOf Log */
var error = function () {
    var arr = Array.prototype.slice.call(arguments);
    arr.unshift({_innerLvl: LOG.ERROR});
    return Log.apply(this, arr);
};
Object.defineProperty(Log, 'error', {writable: false, value: error});
Object.defineProperty(Log, 'e', {writable: false, value: error});


/** @memberOf Log */
var warn = function () {
    var arr = Array.prototype.slice.call(arguments);
    arr.unshift({_innerLvl: LOG.WARN});
    return Log.apply(this, arr);
};
Object.defineProperty(Log, 'warn', {writable: false, value: warn});
Object.defineProperty(Log, 'w', {writable: false, value: warn});


/** @memberOf Log */
var debug = function () {
    var arr = Array.prototype.slice.call(arguments);
    arr.unshift({_innerLvl: LOG.DEBUG});
    return Log.apply(this, arr);
};
Object.defineProperty(Log, 'debug', {writable: false, value: debug});
Object.defineProperty(Log, 'd', {writable: false, value: debug});

/** @memberOf Log */
var verbose = function () {
    var arr = Array.prototype.slice.call(arguments);
    arr.unshift({_innerLvl: LOG.VERBOSE});
    return Log.apply(this, arr);
};
Object.defineProperty(Log, 'verbose', {writable: false, value: verbose});
Object.defineProperty(Log, 'v', {writable: false, value: verbose});

// logLevel manipulation
Object.defineProperty(Log, 'level', {
    configurable: false,
    enumerable: false,
    set: function (newLvl) {
        if (LOG_REVERSE[newLvl]) {
            logLevel = newLvl
        }
        else if (LOG[newLvl]) {
            logLevel = LOG[newLvl]
        }
    },
    get: function () {
        return logLevel
    }
});
Object.defineProperty(Log, 'default', {
    configurable: false,
    enumerable: false,
    set: function (newLvl) {
        if (LOG_REVERSE[newLvl]) {
            defaultLevel = newLvl
        }
        else if (LOG[newLvl]) {
            defaultLevel = LOG[newLvl]
        }
    },
    get: function () {
        return defaultLevel
    }
});

// Define Constants
Object.defineProperty(Log, 'NONE', {writable: false, value: LOG.NONE});
Object.defineProperty(Log, 'ERROR', {writable: false, value: LOG.ERROR});
Object.defineProperty(Log, 'WARN', {writable: false, value: LOG.WARN});
Object.defineProperty(Log, 'LOG', {writable: false, value: LOG.LOG});
Object.defineProperty(Log, 'DEBUG', {writable: false, value: LOG.DEBUG});
Object.defineProperty(Log, 'VERBOSE', {writable: false, value: LOG.VERBOSE});

module.exports = Log;