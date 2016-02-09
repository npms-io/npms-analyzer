# npms-analyzer

[![NPM version][npm-image]][npm-url] [![Downloads][downloads-image]][npm-url] [![Build Status][travis-image]][travis-url] [![Coverage Status][coveralls-image]][coveralls-url] [![Dependency status][david-dm-image]][david-dm-url] [![Dev Dependency status][david-dm-dev-image]][david-dm-dev-url]

[npm-url]:https://npmjs.org/package/npms-analyzer
[downloads-image]:http://img.shields.io/npm/dm/npms-analyzer.svg
[npm-image]:http://img.shields.io/npm/v/npms-analyzer.svg
[travis-url]:https://travis-ci.org/npms-io/npms-analyzer
[travis-image]:http://img.shields.io/travis/npms-io/npms-analyzer.svg
[coveralls-url]:https://coveralls.io/r/npms-io/npms-analyzer
[coveralls-image]:https://img.shields.io/coveralls/npms-io/npms-analyzer.svg
[david-dm-url]:https://david-dm.org/npms-io/npms-analyzer
[david-dm-image]:https://img.shields.io/david/npms-io/npms-analyzer.svg
[david-dm-dev-url]:https://david-dm.org/npms-io/npms-analyzer#info=devDependencies
[david-dm-dev-image]:https://img.shields.io/david/dev/npms-io/npms-analyzer.svg

> The npms-analyzer is responsible for analyzing all npm modules.

This project is composed of two important facets. One is the process of observing changes within the `npm` registry as well as modules that were not analyzed for a while. These modules are pushed into a queue to be analyzed later. The other is the process of consuming the queued modules, analyzing them using a variety of policies and computing a final rank based on the analysis result. Both the analysis and the rank are indexed to power up the `npms` search!


## Usage

This project exposes all its functionality through a CLI.

![Demo](https://i.imgur.com/nz9CzVR.gif)

Keep reading to learn more about the CLI and its commands.

### npms-analyzer observe

The `observe` command starts observing changes that occur in the `npm` registry as well as modules that were not analyzed for a while. Each reported module will be pushed into a queue to be analyzed by the queue consumers.

Bellow is an example of running the command locally:

`$ npms-analyzer observe --log-level verbose`

For more information about the command, run `$ npms-analyzer observe -h`

### npms-analyzer consume

The `consume` command starts consuming the queue, running the analysis process for each module.

Bellow is an example of running the command locally:

`$ npms-analyzer consume --log-level verbose --concurrency 5`

For more information about the command, run `$ npms-analyzer consume -h`


## Architecture

There's a separate document that explains the architecture, you may read it [here](./docs/architecture.md).


## Setup

There's a separate document that explains the setup procedure, you may read it [here](./docs/setup.md).


## Tests

Before running the tests, you must have read through the setup guide.

`$ npm test`   
`$ npm test-cov` to get coverage report


## License

Released under the [MIT License](http://www.opensource.org/licenses/mit-license.php).
