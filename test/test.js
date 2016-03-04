'use strict';

const fs = require('fs');

const walk = (dir) => fs.readdirSync(dir).forEach((file) => {
    const filePath = [dir, file].join('/');

    if (fs.statSync(filePath).isDirectory()) {
        describe(file, () => walk(filePath));
    } else {
        require(filePath);
    }
});

walk(`${__dirname}/spec`);
