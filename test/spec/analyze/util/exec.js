'use strict';

const expect = require('chai').expect;
const exec = require(`${process.cwd()}/lib/analyze/util/exec`);

describe('exec', () => {
    it('should provide a promise based child_processed#exec', () => {
        return exec('echo foo')
        .then(() => {});
    });

    it('should resolve with an array with `stdout` and `stderr` items', () => {
        return Promise.resolve()
        .then(() => {
            return exec('echo foo')
            .spread((stdout, stderr) => {
                expect(stdout).to.equal('foo\n');
                expect(stderr).to.equal('');
            });
        })
        .then(() => {
            return exec('echo foo 1>&2')
            .spread((stdout, stderr) => {
                expect(stdout).to.equal('');
                expect(stderr).to.equal('foo\n');
            });
        });
    });

    it('should reject with an error, containing an additional `stdout` and `stderr` properties', () => {
        return exec('echo foo && exit 1')
        .then(() => {
            throw new Error('Should have failed');
        }, (err) => {
            expect(err.exitCode).to.equal(1);
            expect(err.stdout).to.equal('foo\n');
            expect(err.stderr).to.equal('');

            return exec('echo foo 1>&2 && exit 2')
            .then(() => {
                throw new Error('Should have failed');
            }, (err) => {
                expect(err.exitCode).to.equal(2);
                expect(err.stdout).to.equal('');
                expect(err.stderr).to.equal('foo\n');
            });
        });
    });

    describe('escape', () => {
        it('should offer an es6 template tag for escaping arguments', () => {
            const command = exec.escape`echo ${'foo>bar'} ${'| something'}`;

            expect(command).to.equal('echo \'foo>bar\' \'| something\'');
        });
    });
});
