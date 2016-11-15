'use strict';

const expect = require('chai').expect;
const sepia = require(`${process.cwd()}/test/util/sepia`);
const chronokinesis = require('chronokinesis');
const loadJsonFile = require('load-json-file');
const packageJsonFromData = require(`${process.cwd()}/lib/analyze/util/packageJsonFromData`);
const metadata = require(`${process.cwd()}/lib/analyze/collect/metadata`);

const fixturesDir = `${process.cwd()}/test/fixtures/analyze/collect`;

describe('metadata', () => {
    before(() => {
        sepia.fixtureDir(`${fixturesDir}/recorded/metadata`);
        chronokinesis.travel('2016-05-08T10:00:00.000Z');
    });
    after(() => chronokinesis.reset());

    ['cross-spawn'].forEach((name) => {
        it(`should collect \`${name}\` correctly`, () => {
            const data = loadJsonFile.sync(`${fixturesDir}/modules/${name}/data.json`);
            const expected = loadJsonFile.sync(`${fixturesDir}/modules/${name}/expected-metadata.json`);

            return metadata(data, packageJsonFromData(name, data))
            .then((collected) => expect(collected).to.eql(expected));
        });
    });

    it('should do a best effort to get the author username');

    it('should do a best effort to extract the publisher', () => {
        // Extract from npmUser
        return Promise.try(() => {
            const packageJson = {
                name: 'cross-spawn',
                _npmUser: { name: 'satazor', email: 'andremiguelcruz@msn.com' },
            };

            return metadata({}, packageJson)
            .then((collected) => expect(collected.publisher).to.eql({ username: 'satazor', email: 'andremiguelcruz@msn.com' }));
        })
        // Compare author with maintainers (top-level)
        .then(() => {
            const data = { maintainers: [{ name: 'satazor', email: 'andremiguelcruz@msn.com' }] };
            const packageJson = {
                name: 'cross-spawn',
                author: { name: 'André Cruz', email: 'andremiguelcruz@msn.com' },
            };

            return metadata(data, packageJson)
            .then((collected) => expect(collected.publisher).to.eql({ username: 'satazor', email: 'andremiguelcruz@msn.com' }));
        })
        // Compare author with maintainers
        .then(() => {
            const packageJson = {
                name: 'cross-spawn',
                author: { name: 'André Cruz', email: 'andremiguelcruz@msn.com' },
                maintainers: [{ name: 'satazor', email: 'andremiguelcruz@msn.com' }],
            };

            return metadata({}, packageJson)
            .then((collected) => expect(collected.publisher).to.eql({ username: 'satazor', email: 'andremiguelcruz@msn.com' }));
        });
    });

    it('should do a best effort to extract the maintainers', () => {
        // Compare author with maintainers (top-level)
        return Promise.try(() => {
            const data = { maintainers: [{ name: 'satazor', email: 'andremiguelcruz@msn.com' }] };
            const packageJson = { name: 'cross-spawn' };

            return metadata(data, packageJson)
            .then((collected) => expect(collected.maintainers).to.eql([{ username: 'satazor', email: 'andremiguelcruz@msn.com' }]));
        })
        // Compare author with maintainers
        .then(() => {
            const packageJson = {
                name: 'cross-spawn',
                maintainers: [{ name: 'satazor', email: 'andremiguelcruz@msn.com' }],
            };

            return metadata({}, packageJson)
            .then((collected) => expect(collected.maintainers).to.eql([{ username: 'satazor', email: 'andremiguelcruz@msn.com' }]));
        });
    });

    it('should not fail if there are no versions nor time properties', () => {
        return metadata({}, { name: 'cross-spawn' })
        .then((collected) => expect(collected.name).to.equal('cross-spawn'));
    });

    it('should delete README if it is `No README data`', () => {
        return metadata({ readme: 'No README data' }, { name: 'cross-spawn' })
        .then((collected) => expect(collected).to.not.have.property('readme'));
    });

    it('should handle strange README\'s', () => {
        // In old modules the README is an object, e.g.: `flatsite`
        return metadata({ readme: {} }, { name: 'flatsite' })
        .then((collected) => expect(collected).to.not.have.property('readme'));
    });

    it('should handle bundleDependencies compatibility', () => {
        const packageJson = {
            name: 'flatsite',
            bundleDependencies: { react: '15.0.0' },
        };

        // In old modules the README is an object, e.g.: `flatsite`
        return metadata({}, packageJson)
        .then((collected) => expect(collected.bundledDependencies).to.eql({ react: '15.0.0' }));
    });

    it('should detect deprecated repositories', () => {
        return metadata({}, { name: 'cross-spawn', deprecated: 'use something else' })
        .then((collected) => expect(collected.deprecated).to.equal('use something else'));
    });

    it('should detect repositories with no test script', () => {
        // No scripts
        return Promise.try(() => {
            return metadata({}, { name: 'cross-spawn' })
            .then((collected) => expect(collected).to.not.have.property('hasTestScript'));
        })
        // No test scripts
        .then(() => {
            return metadata({}, { name: 'cross-spawn', scripts: {} })
            .then((collected) => expect(collected).to.not.have.property('hasTestScript'));
        })
        // No tests specified
        .then(() => {
            return metadata({}, { name: 'cross-spawn', scripts: { test: 'no test specified' } })
            .then((collected) => expect(collected).to.not.have.property('hasTestScript'));
        })
        // Detect test
        .then(() => {
            return metadata({}, { name: 'cross-spawn', scripts: { test: 'mocha' } })
            .then((collected) => expect(collected.hasTestScript).to.equal(true));
        });
    });

    it('should detect & remove broken links', () => {
        // Test all broken
        return Promise.resolve()
        .then(() => {
            return metadata({}, {
                name: 'broken-link',
                homepage: 'http://somedomainthatwillneverexist.org',
                repository: { type: 'git', url: 'git://github.com/some-org/some-module-that-will-never-exist.git' },
                bugs: 'http://somedomainthatwillneverexist.org',
            })
            .then((collected) => expect(Object.keys(collected.links)).to.eql(['npm']));
        })
        // Test broken homepage (should fallback to repository)
        .then(() => {
            return metadata({}, {
                name: 'broken-link',
                homepage: 'http://somedomainthatwillneverexist.org',
                repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            })
            .then((collected) => {
                expect(Object.keys(collected.links)).to.eql(['npm', 'homepage', 'repository', 'bugs']);
                expect(collected.links.homepage).to.equal('https://github.com/IndigoUnited/node-cross-spawn#readme');
            });
        });
    });

    describe('license', () => {
        it('should deal with licenses as arrays of strings', () => {
            return metadata({}, { name: 'cross-spawn', license: ['MIT'] })
            .then((collected) => expect(collected.license).to.equal('MIT'));
        });

        it('should deal with licenses as arrays of objects', () => {
            return metadata({}, {
                name: 'cross-spawn',
                license: [
                    { type: 'MIT', url: 'https://opensource.org/licenses/MIT' },
                    { type: 'GPL-3.0', url: 'https://opensource.org/licenses/GPL-3.0' },
                ],
            })
            .then((collected) => expect(collected.license).to.equal('MIT OR GPL-3.0'));
        });

        it('should deal with licenses as objects', () => {
            return metadata({}, {
                name: 'cross-spawn',
                license: { type: 'MIT', url: 'https://opensource.org/licenses/MIT' },
            })
            .then((collected) => expect(collected.license).to.equal('MIT'));
        });

        it('should deal with weird licenses value types', () => {
            // Empty string
            return Promise.try(() => {
                return metadata({}, {
                    name: 'cross-spawn',
                    license: { type: '', url: 'https://opensource.org/licenses/MIT' },
                })
                .then((collected) => expect(collected.license).to.equal(undefined));
            })
            // Nullish
            .then(() => {
                return metadata({}, {
                    name: 'cross-spawn',
                    license: { type: null, url: 'https://opensource.org/licenses/MIT' },
                })
                .then((collected) => expect(collected.license).to.equal(undefined));
            });
        });

        it('should preserve spdx expressions', () => {
            return metadata({}, {
                name: 'cross-spawn',
                license: 'MIT OR GPL-3.0',
            })
            .then((collected) => expect(collected.license).to.equal('MIT OR GPL-3.0'));
        });

        it('should correct to spdx licenses', () => {
            // Test auto-correct
            return Promise.try(() => {
                return metadata({}, {
                    name: 'cross-spawn',
                    license: 'GPL',
                })
                .then((collected) => expect(collected.license).to.equal('GPL-3.0'));
            })
            // Test invalid license
            .then(() => {
                return metadata({}, {
                    name: 'cross-spawn',
                    license: 'foobar',
                })
                .then((collected) => expect(collected.license).to.equal(undefined));
            });
        });
    });

    describe('empty', () => {
        it('should generate an empty metadata object');
    });
});
