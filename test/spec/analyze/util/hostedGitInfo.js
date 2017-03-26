'use strict';

const expect = require('chai').expect;
const hostedGitInfo = require(`${process.cwd()}/lib/analyze/util/hostedGitInfo`);

describe('hostedGitInfo', () => {
    it('should be wrapper to hosted-git-info#fromUrl', () => {
        [
            'git://github.com/IndigoUnited/node-cross-spawn.git',
            'git@github.com:IndigoUnited/node-cross-spawn.git',
            'https://github.com/IndigoUnited/node-cross-spawn.git',
        ].forEach((url) => {
            const info = hostedGitInfo(url);

            expect(info).to.be.an('object');
            expect(info.type).to.equal('github');
            expect(info.domain).to.equal('github.com');
            expect(info.user).to.equal('IndigoUnited');
            expect(info.project).to.equal('node-cross-spawn');
        });

        [
            'git@gitlab.com:codium/angular-ui-select.git',
            'https://gitlab.com/codium/angular-ui-select.git',
        ].forEach((url) => {
            const info = hostedGitInfo(url);

            expect(info).to.be.an('object');
            expect(info.type).to.equal('gitlab');
            expect(info.domain).to.equal('gitlab.com');
            expect(info.user).to.equal('codium');
            expect(info.project).to.equal('angular-ui-select');
        });

        [
            'git@bitbucket.org:fvdm/node-xml2json.git',
            'https://bitbucket.org/fvdm/node-xml2json.git',
        ].forEach((url) => {
            const info = hostedGitInfo(url);

            expect(info).to.be.an('object');
            expect(info.type).to.equal('bitbucket');
            expect(info.domain).to.equal('bitbucket.org');
            expect(info.user).to.equal('fvdm');
            expect(info.project).to.equal('node-xml2json');
        });
    });

    it('should not crash on malformed URLs', () => {
        let info;

        try {
            info = hostedGitInfo('git://github.com/balderdashy/waterline-%s.git');
        } catch (e) {
            throw new Error('Should not crash');
        }

        expect(info).to.equal(undefined);
    });

    it('should not crash on incomplete URLs', () => {
        let info;

        try {
            info = hostedGitInfo('git://github.com');
        } catch (e) {
            throw new Error('Should not crash');
        }

        expect(info).to.equal(undefined);
    });

    describe('normalizeTrailingSlashes', () => {
        it('should remove trailing slashes from a GitHub/GitLab/Bitbucket URLs', () => {
            expect(hostedGitInfo.normalizeTrailingSlashes('git://github.com/IndigoUnited/node-cross-spawn.git//'))
            .to.equal('git://github.com/IndigoUnited/node-cross-spawn.git');
            expect(hostedGitInfo.normalizeTrailingSlashes('git@github.com:IndigoUnited/node-cross-spawn.git//'))
            .to.equal('git@github.com:IndigoUnited/node-cross-spawn.git');
            expect(hostedGitInfo.normalizeTrailingSlashes('https://github.com/IndigoUnited/node-cross-spawn.git//'))
            .to.equal('https://github.com/IndigoUnited/node-cross-spawn.git');

            expect(hostedGitInfo.normalizeTrailingSlashes('git@gitlab.com:codium/angular-ui-select.git//'))
            .to.equal('git@gitlab.com:codium/angular-ui-select.git');
            expect(hostedGitInfo.normalizeTrailingSlashes('https://gitlab.com/codium/angular-ui-select.git//'))
            .to.equal('https://gitlab.com/codium/angular-ui-select.git');

            expect(hostedGitInfo.normalizeTrailingSlashes('git@bitbucket.org:fvdm/node-xml2json.git//'))
            .to.equal('git@bitbucket.org:fvdm/node-xml2json.git');
            expect(hostedGitInfo.normalizeTrailingSlashes('https://bitbucket.org/fvdm/node-xml2json.git//'))
            .to.equal('https://bitbucket.org/fvdm/node-xml2json.git');

            expect(hostedGitInfo.normalizeTrailingSlashes('git@foo.bar:foo/bar//')).to.equal('git@foo.bar:foo/bar//');
        });
    });
});
