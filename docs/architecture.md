## Architecture

This document tries to summarize the architecture of the project.


## Overview

![Overview](./diagrams/npms-analyzer-overview.png)


## Analyzers

The analyzers are responsible for extracting and gathering useful information about each module. The current analyzers are:

- metadata
- source
- github
- npm


### metadata analyzer

The metadata analyzer extracts basic data and attributes of a module.

- Extract module name, description and keywords
- Extract package author, maintainers and contributors
- Extract the license
- Get releases timing information
- Extract repository and homepage
- Extract README
- Check if the module is deprecated
- Check if the module has a test script

### source analyzer

The source analyzer digs into the source code.

- Simple check for `.npmignore` and `.gitignore`
- Detect linters, such as `eslint`, `jshint`, `jslint` and `jscs`
- Detect badges in the README
- Analyze code complexity
- Analyze code coverage
- Get repository file size
- Get dependencies insight, including if they are outdated
- Search for tech debts: TODOs, FIXMEs, etc
- Get security insight with node security project

### github analyzer

The github analyzer uses GitHub and [Issue Stats](http://issuestats.com/) to collect useful data and statistics
present there.

- Get number of stars, subscribers and forks
- Analyze the repository activity in terms of commits
- Analyze the number of issues as well as the time it takes for them to be closed
- Extract the homepage
- Fetch contributors
- Check the build status

This analyzer is susceptible to the GitHub [rate limit](https://developer.github.com/v3/rate_limit/) policy. To fight
against this limit, you may define several GitHub keys to be used in a round-robin fashion.

### npm analyzer

The npm analyzer uses the replicated CouchDB views and the npm [download-counts](https://github.com/npm/download-counts)
API to extract useful information present there.

- Get number of stars
- Get number of downloads over time
- Get number of dependents


## Scoring

The scoring process uses the analyses result to compute a score for the module. The calculation can be divided in different aspects:

- quality
- popularity
- maintenance
- personalities score

The final score will be calculated using the previous scores.


### quality score

Quality attributes are easy to calculate because they are self contained. These are the kind of attributes that a person analyses first when looking at the module.

- Has README?
- Has tests? has coverage? whats the coverage %?
- Is the version stable? (> 1.x.x)
- Is the module deprecated?
- Has continuous integration? is build passing?
- Has outdated dependencies?
- Has security vulnerabilities?
- Has custom website? has good branding? has badges?
- Does the project have linters configured?
- What's the code complexity score?

### maintenance score

Maintenance score allows us to understand if the module is active & healthy or if it is abandoned. These are typically the second kind of attributes that a person analyses when looking at the module.

- Percentage of open issues among the total issues
- The time it takes to close the issues
- Most recent commit
- Commit frequency

### popularity score

Popularity attributes allows us to understand the module extend and adoption. These are the kind of attributes that a person looks when they are undecided on the module choice.

- Number of stars
- Number of forks
- Number of subscribers
- Number of contributors
- Number of dependents
- Number of downloads
- Downloads acceleration

### personalities score

If modules have similar score, one tend to choose the one in which the author is well known in the community. Also, there are people that simply prefer to use a module over another because the author is popular. While this doesn't directly translate to quality, it's still a strong factor that we should account.

I will not elaborate on this because this score will NOT be developed nor used in the initial release.


## Store & indexing

Both the analysis and scoring is stored is CouchDB and indexed in Elasticsearch. If the scoring algorithm changes in
some way, we can iterate over the stored documents in CouchDB and re-run the scoring for all the entries without having
to re-analyze all the modules which takes some time.
