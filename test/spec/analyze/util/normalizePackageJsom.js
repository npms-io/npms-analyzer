'use strict';

const expect = require('chai').expect;
const normalizePackageJson = require(`${process.cwd()}/lib/analyze/util/normalizePackageJson`);

describe('normalizePackageJson', () => {
    it('should mutate original object', () => {
        const packageJson = { name: 'foo' };
        const normalizedPackageJson = normalizePackageJson('foo', packageJson);

        expect(packageJson).to.equal(normalizedPackageJson);
    });

    it('should set name if present or mismatches', () => {
        expect(normalizePackageJson('foo', { name: '' }).name).to.equal('foo');
        expect(normalizePackageJson('foo', { name: 'bar' }).name).to.equal('foo');
    });

    it('should leave name untouched if options.checkName is false', () => {
        expect(normalizePackageJson('foo', { }, { checkName: false }).name).to.equal('');
        expect(normalizePackageJson('foo', { name: 'bar' }, { checkName: false }).name).to.equal('bar');
    });

    it('should mock version if not present', () => {
        expect(normalizePackageJson('foo', { name: 'foo' }).version).to.equal('0.0.1');
    });

    it('should normalize package json', () => {
        expect(normalizePackageJson('foo', { name: 'foo' }).readme).to.equal('ERROR: No README data found!');
    });

    it('should throw an unrecoverable error if normalize-package-data crashes', () => {
        try {
            normalizePackageJson('foo', {
                name: 'foo',
                repository: { type: 'git', url: 'git://github.com/balderdashy/waterline-%s.git' },
            });
        } catch (err) {
            expect(err.message).to.match(/uri malformed/i);
            expect(err.unrecoverable).to.equal(true);
        }
    });

    it('should normalize repository trailing slashes', () => {
        const packageJson = normalizePackageJson('foo', {
            name: 'foo',
            repository: { type: 'git', url: 'git://github.com/balderdashy/waterline.git/' },
        });

        expect(packageJson.repository.url).to.equal('git://github.com/balderdashy/waterline.git');
    });
});
