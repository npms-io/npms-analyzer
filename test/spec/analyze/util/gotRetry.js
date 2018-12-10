'use strict';

const expect = require('chai').expect;
const betray = require('betray');
const gotRetry = require(`${process.cwd()}/lib/analyze/util/gotRetry`);

const gotRetries = gotRetry.retries;

const transientError = Object.assign(new Error('foo'), { code: 'EAI_AGAIN', href: 'http://google.com' });
const httpError = Object.assign(new Error('foo'), { statusCode: 503, method: 'GET', href: 'http://google.com' });

describe('gotRetry', () => {
    it('should export an object', () => {
        expect(gotRetry).to.be.an('object');
        expect(gotRetry.retries).to.be.an('function');
    });

    it('should retry on transient errors', () => {
        expect(gotRetries(1, transientError)).to.be.above(0);
    });

    it('should retry on some HTTP errors', () => {
        expect(gotRetries(1, httpError)).to.be.above(0);
    });

    it('should not retry when an unrecognized error occurs', () => {
        expect(gotRetries(1, new Error())).to.equal(0);
    });

    it('should not retry after attempt 5', () => {
        expect(gotRetries(5 + 1, transientError)).to.equal(0);
        expect(gotRetries(Number.MAX_VALUE, transientError)).to.equal(0);
    });

    it('should log when retrying', () => {
        const betrayed = betray(logger.children['util/got-retry'], 'warn');

        gotRetries(1, transientError);

        expect(betrayed.invoked).to.greaterThan(0);
        expect(betrayed.invocations[0][0]).to.eql({ url: transientError.href, iteration: 1, error: transientError });
        expect(betrayed.invocations[0][1]).to.match(/retrying request../i);
    });
});
