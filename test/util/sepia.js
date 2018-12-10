'use strict';

/**
 * This file adds .enable() and .disable() to sepia.
 * Additionally any usage of nock must use sepia.nock so that interoperability with sepia works without issues.
 */

const glob = require('glob');
const http = require('http');
const https = require('https');
const wrap = require('lodash/wrap');
const mockRequire = require('mock-require');

// Grab original requests
const originalRequests = { http: http.request, https: https.request };

// Grab sepia requests + nock (used when enabled)
const sepia = require('sepia');
const enabledNock = require('nock');
const sepiaRequests = { http: http.request, https: https.request };

// Grab standalone requests + nock (used when disabled)
http.request = originalRequests.http;
https.request = originalRequests.https;
delete require.cache[require.resolve('nock')];
glob.sync('**/*.js', { cwd: `${process.cwd()}/node_modules/nock/lib` }).forEach((file) => {
    delete require.cache[require.resolve(`nock/lib/${file}`)];
});
const disabledNock = require('nock');

// Map abort to end due to a bug in nock, see: https://github.com/nock/nock/issues/867
http.request = wrap(http.request, (request, options, callback) => {
    const req = request(options, callback);

    return Object.assign(req, { abort: req.end });
});
https.request = wrap(https.request, (request, options, callback) => {
    const req = request(options, callback);

    return Object.assign(req, { abort: req.end });
});

const nockedRequests = { http: http.request, https: https.request };

// Mock the timed-out module used by got() to avoid timeouts being triggered: the socket 'connect' event
// is never fired when using sepia/nock
// See: https://github.com/floatdrop/timed-out/blob/bdc812346570a0ed4e6d7d5fdc668e2feb72f239/index.js#L21
mockRequire('timed-out', (req) => req);

function enable() {
    http.request = sepiaRequests.http;
    https.request = sepiaRequests.https;
    sepia.nock = enabledNock;
}

function disable() {
    http.request = nockedRequests.http;
    https.request = nockedRequests.https;
    sepia.nock = disabledNock;
}

sepia.enable = enable;
sepia.disable = disable;
sepia.nock = disabledNock;

module.exports = sepia;
