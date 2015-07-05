'use strict';

var crypto = require('../utils/crypto');
var utils = require('../utils/utils');
var E = require('../utils/errors');

exports.validateMessage = function (message) {
    var conf = this._conf;
    if (!message || !message.token) {
        throw E.NOT_AUTHORIZED;
    }
    var token = crypto.decrypt(message.token, conf.secret);
    if (!token || !/AGENT:::\d{13,14}/.test(token)) {
        throw E.WRONG_SECRET;
    }

    token = token.split(':::');
    var stamp = parseInt(token[1]);

    if (!utils.isValidDate(new Date(stamp) || +new Date - stamp > 864e5)) {
        throw E.MESSAGE_TOO_OLD;
    }
    delete message.token
};

exports.signMessage = function (message) {
    var conf = this._conf;

    var token = "AGENT:::" + +new Date;

    var hash = crypto.encrypt(token, conf.secret);

    message = message || {};
    message.token = hash;
};