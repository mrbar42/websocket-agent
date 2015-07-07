'use strict';

var crypto = require('../utils/crypto');
var utils = require('../utils/utils');
var E = require('./errors');

/**
 * Decrypts a token and validate its integrity
 *
 * @param {object} message
 * @param {string} message.token - token to verify
 * @param {string} secret - secret to decrypt with
 * @returns {object} verified message
 * @throws {E} validationError
 */
exports.validateMessage = function (message, secret) {
    if (!message || !message.token) {
        throw E.NOT_AUTHORIZED;
    }
    var token = crypto.decrypt(message.token, secret);
    if (!token || !/AGENT:::\d{13,14}/.test(token)) {
        throw E.WRONG_SECRET;
    }

    token = token.split(':::');
    var stamp = parseInt(token[1]);

    if (!utils.isValidDate(new Date(stamp) || +new Date - stamp > 864e5)) {
        throw E.MESSAGE_TOO_OLD;
    }
    delete message.token;

    return message
};

/**
 * Generate an encrypted token and add to the message
 *
 * @param {object} [message]
 * @param {string} secret - secret to encrypt with
 * @returns {object} signed message with token
 */
exports.signMessage = function (message, secret) {

    var token = "AGENT:::" + +new Date;

    var hash = crypto.encrypt(token, secret);
    message = message || {};
    message.token = hash;

    return message;
};