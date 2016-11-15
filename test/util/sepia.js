'use strict';

/**
 * This file adds .enable() and .disable() to sepia.
 * Additionally any usage of nock must use sepia.nock so that interoperability with sepia works without issues.
 */

const glob = require('glob');
const http = require('http');
const https = require('https');
const clearRequire = require('clear-require');

// Grab original requests
const originalRequests = { http: http.request, https: https.request };

// Grab sepia requests + nock (used when enabled)
const sepia = require('sepia');
const enabledNock = require('nock');
const sepiaRequests = { http: http.request, https: https.request };

// Grab standalone requests + nock (used when disabled)
http.request = originalRequests.http;
https.request = originalRequests.https;
clearRequire('nock');
glob.sync('**/*.js', { cwd: `${process.cwd()}/node_modules/nock/lib` }).forEach((file) => clearRequire(`nock/lib/${file}`));
const disabledNock = require('nock');
const nockedRequests = { http: http.request, https: https.request };

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

module.exports = sepia;
