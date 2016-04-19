BPromise = require 'bluebird'
JSONStream = require 'JSONStream'
_ = require 'lodash'
fetch = require 'node-fetch'
queryString = require 'querystring'
url = require 'url'

REPLICATION_STATS_NAME_MAP =
  revisionsChecked: 'revisions_checked'
  missingRevisionsFound: 'missing_revisions_found'
  docsRead: 'docs_read'
  docsWritten: 'docs_written'
  docWriteFailures: 'doc_write_failures'
  checkpointedSourceSeq: 'checkpointed_source_seq'

DB_NOT_FOUND_RE = /^db_not_found: /

checkStatus = (response) ->
  if response.status >= 200 and response.status < 300
    return response
  else
    error = new Error(response.statusText)
    error.response = response
    throw error

buildQueryString = (options) ->
  if options.groupLevel?
    options['group_level'] = options.groupLevel
    delete options.groupLevel

  if options.includeDocs?
    options['include_docs'] = options.includeDocs
    delete options.includeDocs

  if Array.isArray(options.endkey)
    options.endkey = JSON.stringify(options.endkey)

  if Array.isArray(options.startkey)
    options.startkey = JSON.stringify(options.startkey)

  # remove undefined vars because `queryString.stringify` doesn't like them
  options = _.pickBy(options, (value) -> value?)
  if Object.keys(options).length > 0
    '?' + queryString.stringify(options)
  else
    ''

class CouchDB
  auth: ''
  dbName: ''
  url: ''

  constructor: (rawUrl) ->
    urlObj = url.parse(rawUrl)
    @dbName = urlObj.pathname[1...] # cut off leading slash
    @auth = urlObj.auth
    urlObj.auth = ''
    @url = url.format(urlObj)
    if @dbName isnt '_replicator'
      urlObj.pathname = '_replicator'
      @replicatorDB = new CouchDB(url.format(urlObj))

  _getHeaders: ->
    headers =
      'Accept': 'application/json'
      'Content-Type': 'application/json'
    if @auth?
      headers['Authorization'] = "Basic #{new Buffer(@auth).toString('base64')}"
    return headers

  ###*
   * Create the database on the server.
   * @param {Boolean} [options.errorIfExists = false] By default, we ignore
     whether or not the database already exists. Setting this to true will cause
     an error to be thrown if the database has already been created.
   * @return {Promise}
  ###
  createDatabase: ({errorIfExists} = {}) =>
    errorIfExists ?= false
    promise = fetch(
      @url
      method: 'PUT'
      headers: @_getHeaders()
      credentials: 'include'
    ).then(
      checkStatus
    )
    if not errorIfExists
      promise = promise.catch((err) ->
        # ignore "database already exists"
        if err.response.status isnt 412 then throw err
      )
    return promise

  ###*
   * Query the database
   * @param {[type]} view [description]
   * @return {Stream} A stream containing the results of the query.
  ###
  query: (options) =>
    {
      design
      endkey
      groupLevel
      includeDocs
      limit
      reduce
      startkey
      view
    } = options

    isAllDocs = false
    if design? and view?
      queryUrl = "#{@url}/_design/#{design}/_view/#{view}"
    else
      isAllDocs = true
      queryUrl = "#{@url}/_all_docs"

    queryUrl += buildQueryString(
      {startkey, endkey, limit, reduce, groupLevel, includeDocs}
    )

    output = JSONStream.parse('rows.*', (res) ->
      if isAllDocs and res.id[0] is '_'
        # all_docs queries include design docs, which is weird
        return null
      return res
    )
    BPromise.resolve(
      fetch(queryUrl, headers: @_getHeaders(), credentials: 'include')
    ).then(
      checkStatus
    ).then((response) ->
      response.body.pipe(output)
    ).catch((err) ->
      output.emit('error', err)
    ).done()
    return output

  ###*
   * Query the database
   * @return {Promise} A promise for the requested value
  ###
  queryOne: ({design, view, startkey, endkey, limit, reduce, groupLevel}) =>
    if view? and not design?
      return BPromise.reject(new Error('In order to use a view, you must pass
      the id of the design document that the view is a part of.'))

    if design? and view?
      queryUrl = "#{@url}/_design/#{design}/_view/#{view}"
      queryUrl += buildQueryString(
        {startkey, endkey, limit, reduce, groupLevel}
      )

    BPromise.resolve(
      fetch(queryUrl, headers: @_getHeaders(), credentials: 'include')
    ).then(
      checkStatus
    ).then((response) ->
      response.json()
    ).then(({rows}) ->
      if rows.length > 1
        throw new Error('query returned multiple rows')
      rows[0]
    )

  ###*
   * @param {Object} doc
   * @param {Function} options.resolveConflict
   * @param {Boolean} options.assumeConflict Assume that there will be a
     conflict (like the document already existing & `doc._rev` not being
     passed). In this case we don't try to do a PUT right from the start - we
     do a GET and then run the resolveConflict function on that. This saves us a
     HTTP request if we're correct about it not existing, or it costs us one if
     we're wrong.
   * @return {Promise}
  ###
  putDoc: (doc, {resolveConflict, assumeConflict} = {}) =>
    assumeConflict ?= false
    id = doc._id
    revision = doc._rev
    if not id?
      return BPromise.reject('You need to define doc._id to use PUT. To have
      CouchDB generate an id for you, use POST.')
    if assumeConflict and not resolveConflict?
      return BPromise.reject('You must define a resolveConflict function if you
      are going to use `assumeConflict: true`.')
    if assumeConflict and id is '_security'
      return BPromise.reject('The `_security` document is not a versioned doc,
      so there is no need to use `assumeConflict: true`')

    handleResolution = (resolution) =>
      if resolution isnt false
        # prevent these properties from being modified
        resolution._rev = revision
        resolution._id = id
        @putDoc(resolution, {resolveConflict})
      else
        return {updated: false, rev: revision}

    if assumeConflict
      @getDoc(doc._id).then((oldDoc) ->
        revision = oldDoc._rev
        delete oldDoc._rev # remove temporarily for equality test
        if _.isEqual(oldDoc, doc)
          false
        else
          oldDoc._rev = revision
          resolveConflict(oldDoc, doc)
      ).then(
        handleResolution
        (err) =>
          # we were wrong with `assumeConflict: true`, try again with false
          if err.response?.status is 404
            @putDoc(doc, {resolveConflict})
          else
            throw err
      )
    else
      BPromise.resolve(
        fetch(
          "#{@url}/#{doc._id}"
          method: 'PUT'
          body: JSON.stringify(doc)
          headers: @_getHeaders()
          credentials: 'include'
        )
      ).then(
        checkStatus
      ).then((res) ->
        res.json()
      ).then((res) ->
        {updated: true, rev: res.rev}
      ).catch((err) ->
        if err.response?.status is 409 and resolveConflict?
          @putDoc(doc, {resolveConflict, assumeConflict: true})
        else
          throw err
      )

  # returns writeable stream, where you pass in the document object and get out
  # errors or nothing
  put: ->

  ###*
   * Post a single document to the database.
   * @param {Object} doc The document to post. `doc._id` cannot be defined
     because POST is used when you want CouchDB to create the id for you.
   * @return {Promise}
  ###
  postDoc: (doc) ->
    if id?
      return BPromise.reject("You have passed a doc._id. Since you know the _id,
      you should use PUT, rather than POST.")

    BPromise.resolve(
      fetch(
        @url
        method: 'POST'
        body: JSON.stringify(doc)
        headers: @_getHeaders()
        credentials: 'include'
      )
    ).then(
      checkStatus
    ).then((response) ->
      response.json()
    ).then((response) ->
      delete response.ok # this property is useless because we have a statuscode
      response._id = response.id
      delete response.id
      return response
    )

  ###*
   * Get a single document from the database.
   * @param {String} id Document id
   * @param {String} [options.revision] The specific revision id to get.
   * @return {Promise}
  ###
  getDoc: (id, {revision, revisionsInfo} = {}) =>
    BPromise.resolve(
      fetch(
        "#{@url}/#{encodeURIComponent(id)}"
        headers: @_getHeaders()
        credentials: 'include'
      )
    ).then(
      checkStatus
    ).then((response) ->
      response.json()
    )

  # returns writeable stream where you pass in the ID and get out the doc
  get: ->

  ###*
   * Remove a single document from the database.
   * @param {String} id Document id
   * @param {String} revision The specific revison id of the document.
   * @return {Promise}
  ###
  removeDoc: (id, revision) ->
    BPromise.resolve(
      fetch(
        "#{@url}/#{encodeURIComponent(id)}?rev=#{revision}"
        method: 'DELETE'
        headers: @_getHeaders()
        credentials: 'include'
      )
    ).then(
      checkStatus
    ).then((response) ->
      response.json()
    ).then((response) ->
      delete response.ok # this property is useless because we have a statuscode
      response._id = response.id
      delete response.id
      return response
    )

  # returns writeable stream where you pass in the ID to delete
  remove: ->

  getReplicationStatus: (id) =>
    @replicatorDB.getDoc(id).then((res) ->
      status =
        _id: res._id
        _rev: res._rev
        replicationState: res['_replication_state']
        replicationStateTime: res['_replication_state_time']
        replicationId: res['_replication_id']

      if status.replicationState is 'completed'
        for newName, oldName of REPLICATION_STATS_NAME_MAP
          status[newName] = res['_replication_stats'][oldName]
        status.replicationStateTime = new Date(status.replicationStateTime)
      else if status.replicationState is 'error'
        message = res['_replication_state_reason']
        if DB_NOT_FOUND_RE.test(message)
          console.log 'throwing'
          throw new Error(message.replace(DB_NOT_FOUND_RE, ''))
        else
          throw new Error(message)
      else if status.replicationState? and
              status.replicationState isnt 'triggered'
        throw new Error(
          "Unknown replication state: '#{status.replicationState}'"
        )

      return status
    )

  pollTillReplicationCompleted: (id, timeStarted) =>
    currentTime = (new Date()).getTime()
    timeStarted ?= currentTime
    @getReplicationStatus(id).then((status) =>
      console.log 'got', status
      if not status.replicationState? and timeStarted - currentTime > 5 * 1000
        throw new Error('Replication has not been triggered after 5 seconds of
        waiting. Check the _replication database for another replication job
        that may be preventing this one from being started.')

      if status.replicationState is 'completed'
        status
      else
        BPromise.delay(
          if timeStarted - currentTime < 10 * 1000
            500
          else
            2000
        ).then(
          @pollTillReplicationCompleted.bind(this, id, timeStarted)
        )
    )

  replicate: ({target, source, createTarget}) =>
    createTarget ?= false
    if target? and source?
      return BPromise.reject(
        'setting both target and source isn\'t supported yet'
      )

    if not target? and not source?
      return BPromise.reject(
        'you must set either target or source with a CouchDB object'
      )

    jobDoc = {target, source}
    jobDoc['create_target'] = createTarget
    jobDoc['user_ctx'] = {roles: ['_admin']}

    # if either target or source is omitted, then we assume that this database
    # is the omitted field.
    if jobDoc.target?
      jobDoc.source = @dbName
    else
      jobDoc.target = @dbName

    stats = undefined
    @replicatorDB.postDoc(jobDoc).then((res) =>
      @pollTillReplicationCompleted(res._id)
    ).then((statsObj) =>
      stats = statsObj
      @replicatorDB.removeDoc(stats._id, stats._rev)
    ).then( ->
      stats
    )

module.exports = {CouchDB}
