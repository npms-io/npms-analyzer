'use strict';

require('coffee-script/register')

const pumpCb = require('pump')
const map = require('through2')
const CouchDB = require('../../couchdb/couchdb').CouchDB

const logPrefix = 'scoring/aggregate';
const pump = Promise.promisify(pumpCb)

/**
 * Grabs the reduce from CouchDB and makes the rows into an aggregation object
   that includes min, max and mean for all scalar values in the evaluations.
 * @return {Promise} The promise that fulfills when done
 */
function getAggregate() {
    var aggregation = {};
    const db = new CouchDB('http://admin:admin@127.0.0.1:5984/npms');
    return pump(
        db.query({
            design: 'npms-analyzer',
            view: 'modules-evaluation',
            groupLevel: 2,
            reduce: true
        }),
        map({objectMode: true}, function (row, enc, cb) {
            row.value.mean = row.value.sum / row.value.count
            if (typeof aggregation[row.key[1]] === 'undefined') {
                aggregation[row.key[1]] = {}
            }
            aggregation[row.key[1]][row.key[0]] = row.value
            cb()
        })
    ).then(() =>
        aggregation
    )
}

module.exports = getAggregate;
