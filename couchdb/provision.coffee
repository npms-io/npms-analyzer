BPromise = require 'bluebird'
fs = require 'fs'
{compile} = require 'coffee-script'

{CouchDB} = require './couchdb'

getFile = (name) ->
  compile(
    fs.readFileSync(require.resolve(name), encoding: 'utf8')
    bare: true
  )

provisionNpmsDb = ->
  db = new CouchDB('http://admin:admin@127.0.0.1:5984/npms')
  (
    db.putDoc(
      {
        _id: '_design/npms-analyzer',
        language: 'javascript',
        views:
          'modules-evaluation':
            map: getFile './views/modules-evaluation'
            reduce: '_stats'
          'modules-stale':
            map: getFile './views/modules-stale'
      }
      assumeConflict: true
      resolveConflict: (oldDoc, doc) -> doc
    )
  )

provisionNpmsDb()
