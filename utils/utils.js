'use strict';

/**
 * Flat object merging
 */
exports.merge = function () {
    var args = Array.prototype.slice.call(arguments);
    var base = args.shift();

    while (args.length) {
        var obj = args.shift();
        if (!obj) continue;
        Object.keys(obj).forEach(function (key) {
            if (obj[key] === undefined) return;
            base[key] = obj[key];
        })
    }

    return base
};

exports.random = function (length, enableSymbols) {
    length = length || 12;
    var s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    if (!enableSymbols) {
        s += "+/=*&^$#@!-_.<>?~";
    }

    var id = "";

    for (var i = 0; i < length; i++) {
        id += s.charAt(Math.floor(Math.random() * s.length));
    }

    return id;
};

exports.isValidDate = function (d) {
    if (Object.prototype.toString.call(d) !== "[object Date]")
        return false;
    return !isNaN(d.getTime());
};