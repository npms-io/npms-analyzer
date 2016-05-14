'use strict';

const expect = require('chai').expect;
const promisePropsSettled = require(`${process.cwd()}/lib/analyze/collect/util/promisePropsSettled`);

describe('promisePropsSettled', () => {
    it('should behave like Promise.props', () => {
        return promisePropsSettled({
            foo: 'foo',
            bar: Promise.resolve('bar'),
        })
        .then((props) => expect(props).to.eql({ foo: 'foo', bar: 'bar' }));
    });

    it('should resolve only when all promises are finished', () => {
        const startTime = Date.now();

        return promisePropsSettled({
            foo: Promise.delay(500),
            bar: Promise.reject(new Error('foo')),
        })
        .then(() => {
            throw new Error('Should have failed');
        }, (err) => {
            expect(err.message).to.equal('foo');
            expect(Date.now() - startTime).to.be.above(498);
        });
    });
});
