# Setup

Below you will find a list of items that you must do to get the project working on your local machine. The production setup document is not present in the repository for security reasons.


## Config file

This project uses [config](https://www.npmjs.com/package/config) for configuration. You may create `config/local.json5` file to override the configuration as necessary, especially to define `githubTokens`.


## General utilities

- `git` must be installed and available in the `$PATH`.
- GNU coreutils (`rm`, `mkdir`, `chmod`) must be available.
- `tar` or `bsdtar` must be available (BSD version is preferred.. on Debian install with `$ aptitude install bsdtar`)
- Install the `pino` CLI to prettify logging output by running `$ npm install -g pino`


## CouchDB

- Install [CouchDB](http://couchdb.apache.org/) and run it (tested with `v1.6.1`).
- Add user `admin` with `admin` as password by executing `curl -X PUT http://localhost:5984/_config/admins/admin -d '"admin"'`. After doing this, operations done in the [web interface](http://localhost:5984/_utils/) require you to login (login is at bottom right corner).
- Create database named `npms` by executing `curl -X PUT http://admin:admin@localhost:5984/npms`
- Change default maximum replication retries to infinite by executing `curl -X PUT http://admin:admin@localhost:5984/_config/replicator/max_replication_retry_count -d '"infinity"'`
- Setup npm replication by executing `curl -X PUT http://admin:admin@localhost:5984/_replicator/npm -d '{ "source": "https://replicate.npmjs.com/registry", "target": "http://admin:admin@localhost:5984/npm", "create_target": true, "continuous": true }'`
- Setup the necessary views by creating the document `_design/npms-analyzer` in the `npms` database with the contents of `https://github.com/npms-io/npms-analyzer/blob/master/config/couchdb/npms-analyzer.json5`


## RabbitMQ

**NOTE**: You may put `RabbitMQ standalone` into the gitignored `dev` folder while developing!

- Install [RabbitMQ](https://www.rabbitmq.com/download.html) and run it (tested with `v3.6.1`).
- Install the [management](https://www.rabbitmq.com/management.html) plugin which is very useful by running `rabbitmq-plugins enable rabbitmq_management`
- Head to `http://localhost:15672` and login with `guest/guest` and see if everything is ok.


## Elasticsearch

**NOTE**: You may put the `Elasticsearch` app into the gitignored `dev` folder while developing!

- Install [Elasticsearch](https://www.elastic.co/downloads/elasticsearch) (tested with `v2.3.1`)
- Install the [head](https://github.com/mobz/elasticsearch-head) plugin to perform various manual operations in a web GUI
- Add these configurations to the `elasticsearch.yml`:
  - `action.auto_create_index: -npms-current,-npms-new,+*``
  - `script.engine.groovy.inline.search: on`
  - `script.engine.groovy.inline.update: on`

  ## Crontab

  If you plan to run this in production, you should add `$ npms-analyzer tasks enqueue-missing` and `$ npms-analyzer tasks clean-extraneous` to crontab. These tasks ensure that, in case of errors, the `npms` packages are in sync with the packages from the `npm` registry.
