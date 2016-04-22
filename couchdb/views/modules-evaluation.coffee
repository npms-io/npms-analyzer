(doc) ->
  if doc._id.indexOf('module!') is 0
    moduleName = doc._id.split('!')[1]
    for key, value of doc.evaluation
      for subKey, subValue of value
        emit([subKey, key, moduleName], subValue)
