'use strict';

var constants = require('./constants');
var PROTOCOL = constants.PROTOCOL;

/**
 *
 * @param {object} conf
 * @param {PROTOCOL} conf.protocol
 * @param {object} [conf.privateKey]
 * @param {object} [conf.certificate]
 * @returns {object} http/s server instance
 */
module.exports = function (conf) {
    var server;
    switch (conf.protocol) {
        case PROTOCOL.WS:
            server = require("http").createServer();
            break;
        case PROTOCOL.WSS:
            if (!conf.privateKey || !conf.certificate) {
                console.error("FATAL: wss WebSocket requires privateKey and certificate in server options");
                process.exit(1);
            }

            var fs = require('fs');
            var https = require('https');
            var options = conf.wssOptions || {};

            if (conf.privateKey) {
                options.key = fs.readFileSync(conf.privateKey, 'utf8')
            }
            if (conf.certificate) {
                options.cert = fs.readFileSync(conf.privateKey, 'utf8')
            }

            server = https.createServer(options);

            break;
        default:
            console.error("FATAL: Invalid protocol -> %s", conf.protocol);
            process.exit(1);
            break;
    }

    return server;
};