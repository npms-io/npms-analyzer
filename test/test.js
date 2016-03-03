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

walk(__dirname + '/spec');
