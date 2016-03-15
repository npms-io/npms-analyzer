'use strict';

const gotRetries = require(`${process.cwd()}/lib/analyze/util/gotRetries`);

describe('gotRetries', () => {
    const maxAttempts = 5;

    it(`should stop after attempt ${maxAttempts}`, () => {
        expect(gotRetries(maxAttempts + 1, new Error())).to.equal(0);
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
