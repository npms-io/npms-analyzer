"use strict";

const fs = require("fs");

let walk = (dir) => fs.readdirSync(dir).forEach((file) => {
    let filePath = [dir, file].join('/');

    if (fs.statSync(filePath).isDirectory()) {
        return describe(file, _ => walk(filePath))
    } else {
        require(filePath)
    }
});

// Inject
global.expect = require('chai').expect;
global.Promise = require('bluebird');

walk(__dirname + '/spec');
