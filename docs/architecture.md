# Architecture

The `npms-analyzer` runs two continuous and distinct processes. One is the `analysis` process where each module gets inspected and evaluated. The other one is the `continuous scoring` process where all modules get a score based on the aggregated evaluation results.

- [Analysis](#analysis)
- [Continuous scoring](#continuous-scoring)

## Analysis

The analysis process analyzes the `npm` modules, producing an analyzes result and a score.

![analysis](./diagrams/analysis.png)

By looking at the diagram above, you get an idea of how the analysis process works. Below you may find a more detailed description for the most complex components. The `grey` components are present in `lib`.

### Observers

Observers continuously push modules to the queue whenever they see fit.

- realtime - Observes the replicated `npm` registry for changes, pushing new or updated modules into the analyze queue.
- stale - Fetches modules that were not analyzed recently, pushing them to the queue.

### Queue

The queue holds all modules that are waiting to be analyzed. This component gives us:

- Burst protection
- No loss of modules on crashes or failures
- Automatic retries

### Analyze

The analyze is a simple pipeline that produces an analysis result:

1. Fetches the module data
2. Downloads the source code
3. Runs the Collectors
4. Runs the evaluators
5. Stores the result in CouchDB and Elasticsearch

Below you may find additional information on the collectors and evaluators.

#### Collectors

The collectors are responsible for gathering useful information about each module from a variety of sources:

- metadata
- source
- github
- npm

##### metadata

The metadata collector extracts basic data and attributes of a module.

- Extract module name, description and keywords
- Extract package author, maintainers and contributors
- Extract the license
- Get releases timing information
- Extract repository and homepage
- Extract README
- Extract the module dependencies
- Check if the module is deprecated
- Check if the module has a test script

##### source

The source collector digs into the source code.

- Check certain files: `.npmignore`, `.gitignore`, `.gitattributes`, README size, tests size, etc
- Detect linters, such as `eslint`, `jshint`, `jslint` and `jscs`
- Detect badges in the README
- Compute code complexity *
- Grab the code coverage %
- Get repository file size
- Get dependencies insight, including if they are outdated
- Search for tech debts: TODOs, FIXMEs, etc *
- Get security insight with node security project

Items signaled with * are not yet done.

##### github

The github collector uses GitHub and [Issue Stats](http://issuestats.com/) to collect useful data and statistics present there.

- Get number of stars, subscribers and forks
- Fetch the repository activity in terms of commits
- Fetch the number of issues and their distribution over time
- Extract the homepage
- Fetch contributors
- Check the build status

This collector is susceptible to the GitHub [rate limit](https://developer.github.com/v3/rate_limit/) policy. To fight against this limit, you may define several GitHub keys to be used in a round-robin fashion.

##### npm

The npm collector uses the replicated CouchDB views and the npm [download-counts](https://github.com/npm/download-counts) API to extract useful information present there.

- Get number of stars
- Get number of downloads over time
- Get number of dependents

#### Evaluators

The evaluators take the information that was previously collected and evaluate different aspects of the module. These aspects are divide in four categories:

- quality
- popularity
- maintenance
- personalities

Evaluators may further divide each of these aspects into more granular ones, but their values are always scalars.

##### quality

Quality attributes are easy to calculate because they are self contained. These are the kind of attributes that a person looks first when looking at the module.

Below are some of the points taken into consideration:

- Has README? Has license? Has .gitignore and friends?
- Is the version stable (> 1.x.x)? Is it deprecated?
- Has tests? Whats their coverage %? Is build passing?
- Has outdated dependencies? Do they have vulnerabilities?
- Has custom website? Has badges?
- Does the project have linters configured?
- What's the code complexity score?

##### maintenance

Maintenance attributes allows us to understand if the module is active & healthy or if it is abandoned. These are typically the second kind of attributes that a person looks when looking at the module.

Below follows some of the points taken into consideration:

- Ratio of open issues vs the total issues
- The time it takes to close issues
- Most recent commit
- Commit frequency

##### popularity

Popularity attributes allows us to understand the module extend and adoption. These are the kind of attributes that a person looks when they are undecided on the module choice.

Below follows some of the points taken into consideration:

- Number of stars
- Number of forks
- Number of subscribers
- Number of contributors
- Number of dependents
- Number of downloads
- Downloads acceleration

##### personalities

If two modules are similar, one tend to choose the one in which the author is well known in the community. Also, there are people that simply prefer to use a module over another because the author is popular. While this doesn't directly translate to quality, it's still a strong factor that we should account. Relationships between people are also important. If user X follows user Y, he might prefer user Y's modules over other people simply because of the bound they have.

I will not elaborate on this because this evaluator will NOT be developed nor used in the initial release.

### Scoring

Calculates the module score based on the current aggregation if any. If there's no aggregation, the module won't be scored at the moment, but it will be later in the `continuous scoring` process.

## Continuous scoring

The continuous scoring process runs once in a while to score all `npm` modules, indexing the score data in `Elasticsearch` to be searchable.

![continuous-scoring](./diagrams/continuous-scoring.png)

By looking at the diagram above, you get an idea of how the continuous scoring process works. Below you may find a more detailed description for each component. The `grey` components are present in `lib`.

One important detail is that the continuous scoring process creates and maintains two [aliases](https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-aliases.html):

- `npms-read`: Should be used to query the score data
- `npms-write`: Should be used to write score data

### Prepare

The prepare step creates a new index and updates the `npms-write` alias to point to that index. It also removes extraneous indices from previous failed cycles (if any).

### Aggregate

The aggregation step iterates all the modules evaluations, calculating the `min`, `max` and `mean` values for each evaluation. The aggregation is stored in CouchDB to also be used by the `analysis` process.

### Score modules

After having the aggregation done, all modules are iterated again to produce a score based on the previously calculated aggregation. The score data for each module is stored in `Elasticsearch` into the index referenced by the `npms-write` alias.

### Finalize

The finalize step updates the `npms-read` alias to point to the newly populated index and deletes the previous index.
