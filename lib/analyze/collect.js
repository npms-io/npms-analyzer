'use strict';

const Promise = require('bluebird');
const assign = require('lodash/assign');
const collectors = require('require-directory')(module, './collectors');

function collect(data, packageJson, config) {
    return Promise.props({
        metadata: collect.metadata(data, packageJson),
        npm: collect.npm(data, config.npmNano),
        github: collect.github(data, packageJson, { token: config.githubToken }),
        source: collect.source(data, packageJson, '.',
            { npmRegistry: `${config.npmNano.config.url}/${config.npmNano.config.db}` }),
    });
}

module.exports = assign(collect, collectors);
