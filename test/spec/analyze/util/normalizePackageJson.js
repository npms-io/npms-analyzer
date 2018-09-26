'use strict';

const expect = require('chai').expect;
const normalizePackageJson = require(`${process.cwd()}/lib/analyze/util/normalizePackageJson`);

describe('normalizePackageJson', () => {
    it('should mutate original object', () => {
        const packageJson = { name: 'foo' };
        const normalizedPackageJson = normalizePackageJson(packageJson);

        expect(packageJson).to.equal(normalizedPackageJson);
    });

    it('should normalize package json', () => {
        expect(normalizePackageJson({ name: 'foo' }).readme).to.equal('ERROR: No README data found!');
    });

    it('should throw an unrecoverable error if normalize-package-data crashes', () => {
        try {
            normalizePackageJson({
                name: 'foo',
                repository: { type: 'git', url: 'git://github.com/balderdashy/waterline-%s.git' },
            });
        } catch (err) {
            expect(err.message).to.match(/uri malformed/i);
            expect(err.unrecoverable).to.equal(true);
        }
    });

    it('should throw an unrecoverable error if there\'s no name', () => {
        try {
            normalizePackageJson({});
        } catch (err) {
            expect(err.message).to.match(/missing name/i);
            expect(err.unrecoverable).to.equal(true);
        }
    });

    it('should normalize repository trailing slashes', () => {
        const packageJson = normalizePackageJson({
            name: 'foo',
            repository: { type: 'git', url: 'git://github.com/balderdashy/waterline.git/' },
        });

        expect(packageJson.repository.url).to.equal('git://github.com/balderdashy/waterline.git');
    });

    it('should remove paths from repository URLs', () => {
        let packageJson;

        packageJson = normalizePackageJson({
            name: 'babel-helper-fixtures',
            repository: 'https://github.com/babel/babel/tree/master/packages/babel-helper-fixtures',
        });

        expect(packageJson.repository.url).to.equal('git+https://github.com/babel/babel.git');

        packageJson = normalizePackageJson({
            name: 'babel-helper-fixtures',
            repository: { type: 'git', url: 'https://github.com/babel/babel/tree/master/packages/babel-helper-fixtures' },
        });

        expect(packageJson.repository.url).to.equal('git+https://github.com/babel/babel.git');
    });
});
