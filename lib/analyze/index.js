'use strict';

const log = require('npmlog');
const promiseRetry = require('promise-retry');
const normalizePackageData = require('normalize-package-data');
const assign = require('lodash/assign');
const collect = require('./collect');
const evaluate = require('./evaluate');

function storeResult(moduleName, result, npmsNano) {
    const key = `module!${moduleName}`;

    return promiseRetry((retry) => {
        return npmsNano.getAsync(key)
        .catch((err) => {
            if (err.error === 'not_found') {
                return { _id: key };
            }

            throw err;
        })
        .then((doc) => {
            if (doc.startedAt && Date.parse(doc.startedAt) >= Date.parse(result.startedAt)) {
                log.warn('analyze', `Skipping storing ${moduleName} analysis result the stored one is more recent`,
                    { analyzedAt: result.analyzedAt, storedAnalyzedAt: doc.analyzedAt });
                return;
            }

            assign(doc, result);

            return npmsNano.insertAsync(doc)
            .catch((err) => {
                if (err.error === 'conflict') {
                    err = new Error(`Conflict while storing ${moduleName} analysis result`);
                    log.warn('analyze', err.message);
                    retry(err);
                }

                throw err;
            });
        });
    });
}

function analyze(moduleName, config) {
    const startedAt = (new Date()).toISOString();

    log.verbose('analyze', `Starting ${moduleName} analysis`);

    // Fetch module data
    return config.npmNano.getAsync(moduleName)
    // Collect info + evaluate
    .then((data) => {
        const packageJson = data.versions[data['dist-tags'].latest];

        normalizePackageData(packageJson);

        return collect(data, packageJson, config)
        .then((info) => {
            return {
                startedAt,
                finishedAt: (new Date()).toISOString(),
                info,
                evaluation: evaluate(info),
            };
        });
    })
    // Store result
    .tap((result) => storeResult(moduleName, result, config.npmsNano))
    .tap((result) => {
        log.verbose('analyze', `Analysis of ${moduleName} completed`, { result });
    }, (err) => {
        log.error('analyze', `Analysis of ${moduleName} failed`, { err });
        throw err;
    })
    .timeout(5 * 60 * 1000);  // 5m timeout just in case..
}

module.exports = analyze;
