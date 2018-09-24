'use strict';

const expect = require('chai').expect;
const gotRetry = require(`${process.cwd()}/lib/analyze/util/gotRetry`);

const gotRetries = gotRetry.retries;

describe('gotRetry', () => {
    it('should export an object', () => {
        expect(gotRetry).to.be.an('object');
        expect(gotRetry.retries).to.be.an('function');
    });

    it('should stop after attempt 5', () => {
        expect(gotRetries(5 + 1, new Error())).to.equal(0);
        expect(gotRetries(Number.MAX_VALUE, new Error())).to.equal(0);
    });

    it('should not stop when a transient error occurs', () => {
        const error = new Error();

        error.code = 'ECONNRESET';
        expect(gotRetries(1, error)).to.be.above(0);
    });

    it('should stop when an unrecognized error occurs', () => {
        const error = new Error();

        error.code = 'FAKE_CODE';
        expect(gotRetries(1, error)).to.equal(0);
    });

    it('should stop when error has no code', () => {
        expect(gotRetries(1, new Error())).to.equal(0);
    });
});
