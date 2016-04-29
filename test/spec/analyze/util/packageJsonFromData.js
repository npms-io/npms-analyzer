'use strict';

const expect = require('chai').expect;
const packageJsonFromData = require(`${process.cwd()}/lib/analyze/util/packageJsonFromData`);

describe('packageJsonFromData', () => {
    it('should return the latest package json', () => {
        const packageJson = packageJsonFromData('foo', {
            name: 'foo',
            'dist-tags': { latest: '1.0.0' },
            versions: {
                '0.1.0': { name: 'foo', version: '0.1.0' },
                '1.0.0': { name: 'foo', version: '1.0.0' },
                '2.0.0': { name: 'foo', version: '2.0.0' },
            },
        });

        expect(packageJson).to.be.an('object');
        expect(packageJson.name).to.equal('foo');
        expect(packageJson.version).to.equal('1.0.0');
    });

    it('should not crash if there\'s no latest dist-tags', () => {
        [
            {
                name: 'foo',
                versions: {
                    '1.0.0': { name: 'foo', version: '1.0.0' },
                    '2.0.0': { name: 'foo', version: '2.0.0' },
                },
            },
            {
                name: 'foo',
                'dist-tags': {},
                versions: {
                    '1.0.0': { name: 'foo', version: '1.0.0' },
                    '2.0.0': { name: 'foo', version: '2.0.0' },
                },
            },
        ].forEach((data) => {
            const packageJson = packageJsonFromData('foo', data);

            expect(packageJson).to.be.an('object');
            expect(packageJson.name).to.equal('foo');
            expect(packageJson.version).to.equal('0.0.1');
        });
    });

    it('should not crash if there\'s no matching version', () => {
        let packageJson;

        packageJson = packageJsonFromData('foo', {
            name: 'foo',
            'dist-tags': { latest: '1.0.0' },
        });

        expect(packageJson).to.be.an('object');
        expect(packageJson.name).to.equal('foo');
        expect(packageJson.version).to.equal('1.0.0');

        packageJson = packageJsonFromData('foo', {
            name: 'foo',
            'dist-tags': { latest: '1.0.0' },
            versions: {
                '2.0.0': { name: 'foo', version: '2.0.0' },
            },
        });

        expect(packageJson).to.be.an('object');
        expect(packageJson.name).to.equal('foo');
        expect(packageJson.version).to.equal('1.0.0');
    });

    it('should fail if names mismatch', () => {
        expect(() => packageJsonFromData('foo', {
            name: 'bar',
            'dist-tags': { latest: '1.0.0' },
            versions: {
                '1.0.0': { name: 'foo', version: '2.0.0' },
            },
        })).to.throw(/name mismatch/i);

        expect(() => packageJsonFromData('bar', {
            name: 'foo',
            'dist-tags': { latest: '1.0.0' },
            versions: {
                '1.0.0': { name: 'foo', version: '2.0.0' },
            },
        })).to.throw(/name mismatch/i);

        // Data is ok but package.json is not, it should simply overwrite
        expect(packageJsonFromData('foo', {
            name: 'foo',
            'dist-tags': { latest: '1.0.0' },
            versions: {
                '1.0.0': { name: 'bar', version: '2.0.0' },
            },
        }).name).to.equal('foo');
    });

    it('should check if versions mismatch', () => {
        const packageJson = packageJsonFromData('foo', {
            name: 'foo',
            'dist-tags': { latest: '1.0.0' },
            versions: {
                '1.0.0': { name: 'foo', version: '2.0.0' },
            },
        });

        expect(packageJson.version).to.equal('1.0.0');
    });

    it('should normalize package json with normalize-package-data', () => {
        const packageJson = packageJsonFromData('foo', {
            name: 'foo',
            'dist-tags': { latest: '1.0.0' },
            versions: {
                '1.0.0': { name: 'foo', version: '1.0.0' },
            },
        });

        expect(packageJson).to.be.an('object');
        expect(packageJson.readme).to.equal('ERROR: No README data found!');
    });
});
