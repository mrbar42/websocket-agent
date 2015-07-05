'use strict';

var crypto = require("crypto");
var Log = require("./Log");

var ALGORITHM = "AES-256-CBC-HMAC-SHA1";
var OUTPUT_ENCODING = "base64";
var INPUT_ENCODING = "utf8";

/**
 * @param {string} str - data to be encrypted (object is stringified)
 * @param {string} key - secret key to encrypt with
 * @returns {string} encrypted string
 */
exports.encrypt = function encrypt(str, key) {
    var encrypted;
    try {
        var cipher = crypto.createCipher(ALGORITHM, key);
        encrypted = cipher.update(str, INPUT_ENCODING, OUTPUT_ENCODING);
        encrypted += cipher.final(OUTPUT_ENCODING);
    }
    catch (e) {
        Log.v("Encryption error", e && e.message);
    }

    return encrypted && reverse(encrypted);
};

/**
 * @param {string} str - encrypted string to decrypt
 * @param {string} key - secret key to decrypt with
 * @returns {string|undefined} data
 */
exports.decrypt = function decrypt(str, key) {
    var decrypted;
    try {
        str = reverse(str);
        var decipher = crypto.createDecipher(ALGORITHM, key);
        decrypted = decipher.update(str, OUTPUT_ENCODING, INPUT_ENCODING);
        decrypted += decipher.final(INPUT_ENCODING);
    }
    catch (e) {
        Log.v("Decryption error", e && e.message);
    }
    return decrypted;
};

function reverse(s) {
    return s.split("").reverse().join("");
}
