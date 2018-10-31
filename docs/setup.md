# Setup

Below you will find a list of items that you must do to get the project working on your local machine. The production setup document is not present in the repository for security reasons.


## Config file

This project uses [config](https://www.npmjs.com/package/config) for configuration. You may create `config/local.json5` file to override the configuration as necessary, especially to define `githubTokens`.


## Programs & utilities

- `node` must be installed and available in `$PATH` (`>= v8`)
- `git` must be installed and available in the `$PATH`.
- GNU coreutils (`rm`, `mkdir`, `chmod`, `wc`) must be available.
- `tar` or `bsdtar` must be available (BSD version is preferred.. on Debian install with `$ aptitude install bsdtar`)
- Install the `pino` CLI to prettify logging output by running `$ npm install -g pino-pretty`


## CouchDB

- Install [CouchDB](http://couchdb.apache.org/) and run it (tested with `v2.2`).
- Create database named `npms` by executing `curl -X PUT http://admin:admin@localhost:5984/npms`
- Setup npm replication from `https://replicate.npmjs.com/registry` to `npm` database in `continuous` mode.
- Setup the necessary views by creating the document `_design/npms-analyzer` in the `npms` database with the contents of `https://github.com/npms-io/npms-analyzer/blob/master/config/couchdb/npms-analyzer.json`

Note: for the replication to work, you might need to [tweak](https://github.com/apache/couchdb/issues/1550#issuecomment-411751809) `auth-plugins` in the CouchDB config:

```
[replicator]
auth_plugins = couch_replicator_auth_noop
```


## RabbitMQ

**NOTE**: You may put `RabbitMQ standalone` into the gitignored `dev` folder while developing!

- Install [RabbitMQ](https://www.rabbitmq.com/download.html) and run it (tested with `v3.6.1`).
- Install the [management](https://www.rabbitmq.com/management.html) plugin which is very useful by running `rabbitmq-plugins enable rabbitmq_management`
- Head to `http://localhost:15672` and login with `guest/guest` and see if everything is ok.


## Elasticsearch

**NOTE**: You may put the `Elasticsearch` app into the gitignored `dev` folder while developing!

- Install [Elasticsearch](https://www.elastic.co/downloads/elasticsearch) (tested with `v6.4`)
- Install the [head](https://github.com/mobz/elasticsearch-head) to perform various manual operations in a web GUI
- Add these configurations to the `elasticsearch.yml`:
  - `action.auto_create_index: -npms-current,-npms-new,+*`


## Crontab

If you plan to run this in production, you should add `$ npms-analyzer tasks enqueue-missing` and `$ npms-analyzer tasks clean-extraneous` to crontab. These tasks ensure that, in case of errors, the `npms` packages are in sync with the packages from the `npm` registry.
