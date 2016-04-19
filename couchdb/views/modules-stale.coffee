(doc) ->
  if doc._id.indexOf('module!') is 0
    emit([Date.parse(doc.finishedAt), doc._id.split('!')[1]])
