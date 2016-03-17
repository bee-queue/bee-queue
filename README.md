<a name="top"></a>

## forked from [LewisJEllis/beequeue](https://github.com/ahkimkoo/beequeue) , support delay job.

![beequeue logo](https://raw.githubusercontent.com/LewisJEllis/bee-queue/master/bee-queue.png)
[![NPM Version][npm-image]][npm-url] [![Build Status][travis-image]][travis-url] [![Coverage Status][coveralls-image]][coveralls-url]

A simple, fast, robust job/task queue for Node.js, backed by Redis.
- Simple: ~500 LOC, and the only dependency is [node_redis](https://github.com/mranney/node_redis).
- Fast: maximizes throughput by minimizing Redis and network overhead. [Benchmarks](#benchmarks) well.
- Robust: designed with concurrency, atomicity, and failure in mind; 100% code coverage.

```javascript
var Queue = require('beequeue');
var queue = new Queue('example');

var job = queue.createJob({x: 2, y: 3}).save();
job.on('succeeded', function (result) {
  console.log('Received result for job ' + job.id + ': ' + result);
});

// Process jobs from as many servers or processes as you like
queue.process(function (job, done) {
  console.log('Processing job ' + job.id);
  return done(null, job.data.x + job.data.y);
});
```

## Introduction
beequeue is meant to power a distributed worker pool and was built with short, real-time jobs in mind. A web server can enqueue a job, wait for a worker process to complete it, and return its results within an HTTP request. Scaling is as simple as running more workers.

[Celery](http://www.celeryproject.org/), [Resque](https://github.com/resque/resque), [Kue](https://github.com/LearnBoost/kue), and [Bull](https://github.com/OptimalBits/bull) operate similarly, but are generally designed for longer background jobs, supporting things like job scheduling and prioritization, which beequeue [currently does not](#contributing). beequeue can handle longer background jobs just fine, but they aren't [the primary focus](#motivation).

- Create, save, and process jobs
- Concurrent processing
- Job timeouts and retries
- Pass events via Pub/Sub
  - Progress reporting
  - Send job results back to creators
- Robust design
  - Strives for all atomic operations
  - Retries [stuck jobs](#under-the-hood)
  - 100% code coverage
- Performance-focused
  - Keeps [Redis usage](#under-the-hood) to the bare minimum
  - Uses [Lua scripting](http://redis.io/commands/EVAL) and [pipelining](http://redis.io/topics/pipelining) to minimize network overhead
  - [Benchmarks](#benchmarks) favorably against similar libraries

## Installation
```
npm install beequeue
```
You'll also need [Redis 2.8+](http://redis.io/topics/quickstart) running somewhere.

# Table of Contents
- [Motivation](#motivation)
- [Benchmarks](#benchmarks)
- [Overview](#overview)
  - [Creating Queues](#creating-queues)
  - [Creating Jobs](#creating-jobs)
  - [Processing Jobs](#processing-jobs)
  - [Progress Reporting](#progress-reporting)
  - [Job & Queue Events](#job-and-queue-events)
  - [Stalled Jobs](#stalled-jobs)
- [API Reference](#api-reference)
- [Under The Hood](#under-the-hood)
- [Contributing](#contributing)
- [License](https://github.com/LewisJEllis/beequeue/blob/master/LICENSE)

# Motivation
Celery is for Python, and Resque is for Ruby, but [Kue](https://github.com/LearnBoost/kue) and [Bull](https://github.com/OptimalBits/bull) already exist for Node, and they're good at what they do, so why does beequeue also need to exist?

In short: we needed to mix and match things that Kue does well with things that Bull does well, and we needed to squeeze out more performance. There's also a [long version](https://github.com/LewisJEllis/beequeue/wiki/Origin) with more details.

beequeue starts by combining Bull's simplicity and robustness with Kue's ability to send events back to job creators, then focuses heavily on minimizing overhead, and finishes by being strict about [code quality](https://github.com/LewisJEllis/beequeue/blob/master/.eslintrc) and [testing](https://coveralls.io/r/LewisJEllis/beequeue?branch=master). It compromises on breadth of features, so there are certainly cases where Kue or Bull might be preferable (see [Contributing](#contributing)).

Bull and Kue do things really well and deserve a lot of credit. beequeue borrows ideas from both, and Bull was an especially invaluable reference during initial development.

#### Why Bees?
beequeue is like a bee because it:
- is small and simple
- is fast (bees can fly 20mph!)
- carries pollen (messages) between flowers (servers)
- something something "worker bees"

# Benchmarks
![benchmark chart](https://raw.githubusercontent.com/LewisJEllis/bee-queue/master/benchmark/benchmark-chart.png)

These basic benchmarks ran 10,000 jobs through each library, at varying levels of concurrency, with io.js 2.2.1 and Redis 3.0.2 running directly on a 13" MBPr. The numbers shown are averages of 3 runs; the raw data collected and code used are available in the benchmark folder.

For a quick idea of space efficiency, the following table contains Redis memory usage as reported by [INFO](http://redis.io/commands/INFO) after doing a [FLUSHALL](http://redis.io/commands/FLUSHALL), restarting Redis, and running a single basic 10k job benchmark:

| Library   | Memory After  | Memory Peak | Memory After Δ | Memory Peak Δ |
| --------- | ------------- | ----------- | -------------- | ------------- |
| beequeue |        2.65MB |      2.73MB |         1.67MB |        1.75MB |
| Bull      |        3.93MB |      5.09MB |         2.95MB |        4.11MB |
| Kue       |        7.53MB |      7.86MB |         6.55MB |        6.88MB |

The Δ columns factor out the ~986KB of memory usage reported by Redis on a fresh startup.

# Overview

## Creating Queues
[Queue](#queue) objects are the starting point to everything this library does. To make one, we just need to give it a name, typically indicating the sort of job it will process:
```javascript
var Queue = require('beequeue');
var addQueue = new Queue('addition');
```
Queues are very lightweight — the only significant overhead is connecting to Redis — so if you need to handle different types of jobs, just instantiate a queue for each:
```javascript
var subQueue = new Queue('subtraction', {
  redis: {
    host: 'somewhereElse'
  },
  isWorker: false
});
```
Here, we pass a `settings` object to specify an alternate Redis host and to indicate that this queue will only add jobs (not process them). See [Queue Settings](#settings) for more options.

## Creating Jobs
Jobs are created using `Queue.createJob(data)`, which returns a [Job](#job) object storing arbitrary `data`.

Jobs have a chaining API with commands `.retries(n)` and `.timeout(ms)` for setting options, and `.save([cb])` to save the job into Redis and enqueue it for processing:

```javascript
var job = addQueue.createJob({x: 2, y: 3});
job.timeout(3000).retries(2).delay(30).save(function (err, job) {
  // job enqueued, job.id populated
});
```

Jobs can later be retrieved from Redis using [Queue.getJob](#queueprototypegetjobjobid-cberr-job), but most use cases won't need this, and can instead use [Job and Queue Events](#job-and-queue-events).

## Schedule Delay Job
### A queue only need to start a scheduler
```javascript
addQueue.schedule(3000);//schedule interval 3000ms
```

## Processing Jobs
To start processing jobs, call `Queue.process` and provide a handler function:
```javascript
addQueue.process(function (job, done) {
  console.log('Processing job ' + job.id);
  return done(null, job.data.x + job.data.y);
});
```
The handler function is given the job it needs to process, including `job.data` from when the job was created. It should then pass results to the `done` callback. For more on handlers, see [Queue.process](#queueprototypeprocessconcurrency-handlerjob-done).

`.process` can only be called once per Queue instance, but we can process on as many instances as we like, spanning multiple processes or servers, as long as they all connect to the same Redis instance. From this, we can easily make a worker pool of machines who all run the same code and spend their lives processing our jobs, no matter where those jobs are created.

`.process` can also take a concurrency parameter. If your jobs spend most of their time just waiting on external resources, you might want each processor instance to handle 10 at a time:
```javascript
var baseUrl = 'http://www.google.com/search?q=';
subQueue.process(10, function (job, done) {
  http.get(baseUrl + job.data.x + '-' + job.data.y, function (res) {
    // parse the difference out of the response...
    return done(null, difference);
  });
});
```

## Progress Reporting
Handlers can send progress reports, which will be received as events on the original job instance:
```javascript
var job = addQueue.createJob({x: 2, y: 3}).save();
job.on('progress', function (progress) {
  console.log('Job ' + job.id + ' reported progress: ' + progress + '%');
});

addQueue.process(function (job, done) {
  // do some work
  job.reportProgress(30);
  // do more work
  job.reportProgress(80);
  // do the rest
  done();
});
```
Just like `.process`, these `progress` events work across multiple processes or servers; the job instance will receive the progress event no matter where processing happens.

## Job and Queue Events

There are three classes of events emitted by beequeue objects: [Queue Local events](#queue-local-events), [Queue PubSub events](#queue-pubsub-events), and [Job events](#job-events). The linked API Reference sections provide a more complete overview of each.

Progress reporting, demonstrated above, happens via Job events. Jobs also emit `succeeded` events, which we've seen in the [opening example](#top), and `failed` and `retrying` events.

Queue PubSub events correspond directly to Job events: `job succeeded`, `job retrying`, `job failed`, and `job progress`. These events fire from all queue instances and for all jobs on the queue.

Queue local events include `ready` and `error` on all queue instances, and `succeeded`, `retrying`, and `failed` on worker queues corresponding to the PubSub events being sent out.

Note that Job events become unreliable across process restarts, since the queue's reference to the associated job object will be lost. Queue PubSub events are thus potentially more reliable, but Job events are more convenient in places like HTTP requests where a process restart loses state anyway.

## Stalling Jobs

beequeue attempts to provide ["at least once delivery"](http://www.cloudcomputingpatterns.org/At-least-once_Delivery), in the sense that any job enqueued should be processed at least once, even if a worker crashes, gets disconnected, or otherwise fails to confirm completion of the job.

To make this happen, workers periodically phone home to Redis about each job they're working on, just to say "I'm still working on this and I haven't stalled, so you don't need to retry it." The [`checkStalledJobs`](#queueprototypecheckstalledjobsinterval-cb) method finds any active jobs whose workers have gone silent (not phoned home for at least [`stallInterval`](#settings) ms), assumes they have stalled, and re-enqueues them.

# API Reference

## Queue

### Settings
The default Queue settings are:
```javascript
var queue = Queue('test', {
  prefix: 'bq',
  stallInterval: 5000,
  redis: {
    host: '127.0.0.1',
    port: 6379,
    db: 0,
    options: {}
  },
  getEvents: true,
  isWorker: true,
  sendEvents: true,
  removeOnSuccess: false,
  catchExceptions: false
});
```
The `settings` fields are:
- `prefix`: string, default `bq`. Useful if the `bq:` namespace is, for whatever reason, unavailable on your redis database.
- `stallInterval`: number, ms; the length of the window in which workers must report that they aren't stalling. Higher values will reduce Redis/network overhead, but if a worker stalls, it will take longer before its stalled job(s) will be retried.
- `redis`: object, specifies how to connect to Redis.
  - `host`: string, Redis host.
  - `port`: number, Redis port.
  - `socket`: string, Redis socket to be used instead of a host and port.
  - `db`: number, Redis [DB index](http://redis.io/commands/SELECT).
  - `options`: options object, passed to [node_redis](https://github.com/mranney/node_redis#rediscreateclient).
- `isWorker`: boolean, default true. Disable if this queue will not process jobs.
- `getEvents`: boolean, default true. Disable if this queue does not need to receive job events.
- `sendEvents`: boolean, default true. Disable if this worker does not need to send job events back to other queues.
- `removeOnSuccess`: boolean, default false. Enable to have this worker automatically remove its successfully completed jobs from Redis, so as to keep memory usage down.
- `catchExceptions`: boolean, default false. Only enable if you want exceptions thrown by the [handler](#queueprototypeprocessconcurrency-handlerjob-done) to be caught by beequeue and interpreted as job failures. Communicating failures via `done(err)` is preferred.

### Properties
- `name`: string, the name passed to the constructor.
- `keyPrefix`: string, the prefix used for all Redis keys associated with this queue.
- `paused`: boolean, whether the queue instance is paused. Only true if the queue is in the process of closing.
- `settings`: object, the settings determined between those passed and the defaults

### Queue Local Events

#### ready
```javascript
queue.on('ready', function () {
  console.log('queue now ready to start doing things');
});
```
The queue has connected to Redis and ensured that the [Lua scripts are cached](http://redis.io/commands/script-load). You can often get away without checking for this event, but it's a good idea to wait for it in case the Redis host didn't have the scripts cached beforehand; if you try to enqueue jobs when the scripts are not yet cached, you may run into a Redis error.

#### error
```javascript
queue.on('error', function (err) {
  console.log('A queue error happened: ' + err.message);
});
```
Any Redis errors are re-emitted from the Queue.

#### succeeded
```javascript
queue.on('succeeded', function (job, result) {
  console.log('Job ' + job.id + ' succeeded with result: ' + result);
});
```
This queue has successfully processed `job`. If `result` is defined, the handler called `done(null, result)`.

#### retrying
```javascript
queue.on('retrying', function (job, err) {
  console.log('Job ' + job.id + ' failed with error ' + err.message ' but is being retried!');
});
```
This queue has processed `job`, but it reported a failure and has been re-enqueued for another attempt. `job.options.retries` has been decremented accordingly.

#### failed
```javascript
queue.on('failed', function (job, err) {
  console.log('Job ' + job.id + ' failed with error ' + err.message);
});
```
This queue has processed `job`, but its handler reported a failure with `done(err)`.

### Queue PubSub Events
These events are all reported by some worker queue (with `sendEvents` enabled) and sent as Redis Pub/Sub messages back to any queues listening for them (with `getEvents` enabled). This means that listening for these events is effectively a monitor for all activity by all workers on the queue.

If the `jobId` of an event is for a job that was created by that queue instance, a corresponding [job event](#job-events) will be emitted from that job object.

Note that Queue PubSub events pass the `jobId`, but do not have a reference to the job object, since that job might have originally been created by some other queue in some other process. [Job events](#job-events) are emitted only in the process that created the job, and are emitted from the job object itself.

#### job succeeded
```javascript
queue.on('job succeeded', function (jobId, result) {
  console.log('Job ' + jobId + ' succeeded with result: ' + result);
});
```
Some worker has successfully processed job `jobId`. If `result` is defined, the handler called `done(null, result)`.

#### job retrying
```javascript
queue.on('job retrying', function (jobId, err) {
  console.log('Job ' + jobId + ' failed with error ' + err.message ' but is being retried!');
});
```
Some worker has processed job `jobId`, but it reported a failure and has been re-enqueued for another attempt.

#### job failed
```javascript
queue.on('job failed', function (jobId, err) {
  console.log('Job ' + jobId + ' failed with error ' + err.message);
});
```
Some worker has processed `job`, but its handler reported a failure with `done(err)`.

#### job progress
```javascript
queue.on('job progress', function (jobId, progress) {
  console.log('Job ' + jobId + ' reported progress: ' + progress + '%');
});
```
Some worker is processing job `jobId`, and it sent a [progress report](#jobprototypereportprogressn) of `progress` percent.

### Methods

#### Queue(name, [settings])

Used to instantiate a new queue; opens connections to Redis.

#### Queue.prototype.createJob(data)
```javascript
var job = queue.createJob({...});
```
Returns a new [Job object](#job) with the associated user data.

#### Queue.prototype.getJob(jobId, cb(err, job))
```javascript
queue.getJob(3, function (err, job) {
  console.log('Job 3 has status ' + job.status);
});
```
Looks up a job by its `jobId`. The returned job will emit events if `getEvents` is true.

Be careful with this method; most potential uses would be better served by job events on already-existing job instances. Using this method indiscriminately can lead to increasing memory usage, as each queue maintains a table of all associated jobs in order to dispatch events.

#### Queue.prototype.process([concurrency], handler(job, done))

Begins processing jobs with the provided handler function.

This function should only be called once, and should never be called on a queue where `isWorker` is false.

The optional `concurrency` parameter sets the maximum number of simultaneously active jobs for this processor. It defaults to 1.

The handler function should:
- Call `done` exactly once
  - Use `done(err)` to indicate job failure
  - Use `done()` or `done(null, result)` to indicate job success
    - `result` must be JSON-serializable (for `JSON.stringify`)
- Never throw an exception, unless `catchExceptions` has been enabled.
- Never ever [block](http://www.slideshare.net/async_io/practical-use-of-mongodb-for-nodejs/47) [the](http://blog.mixu.net/2011/02/01/understanding-the-node-js-event-loop/) [event](http://strongloop.com/strongblog/node-js-performance-event-loop-monitoring/) [loop](http://zef.me/blog/4561/node-js-and-the-case-of-the-blocked-event-loop) (for very long). If you do, the stall detection might think the job stalled, when it was really just blocking the event loop.

#### Queue.prototype.checkStalledJobs([interval], [cb])
Checks for jobs that appear to be stalling and thus need to be retried, then re-enqueues them.

```javascript
queue.checkStalledJobs(5000, function (err) {
  console.log('Checked stalled jobs'); // prints every 5000 ms
});
```

What happens after the check is determined by the parameters provided:
- `cb` only: `cb` is called
- `interval` only: a timeout is set to call the method again in `interval` ms
- `cb` and `interval`: a timeout is set, then `cb` is called

beequeue automatically calls this method once when a worker begins processing, so it will check once if a worker process restarts. You should also make your own call with an interval parameter to make the check happen repeatedly over time; see [Under the hood](#under-the-hood) for an explanation why.

The maximum delay from when a job stalls until it will be retried is roughly `stallInterval` + `interval`, so to minimize that delay without calling `checkStalledJobs` unnecessarily often, set `interval` to be the same or a bit shorter than `stallInterval`. A good system-wide average frequency for the check is every 0.5-10 seconds, depending on how time-sensitive your jobs are in case of failure.

#### Queue.prototype.close([cb])
Closes the queue's connections to Redis.

## Job

### Properties
- `id`: number, Job ID unique to each job. Not populated until `.save` calls back.
- `data`: object; user data associated with the job. It should:
  - Be JSON-serializable (for `JSON.stringify`)
  - Never be used to pass large pieces of data (100kB+)
  - Ideally be as small as possible (1kB or less)
- `options`: object used by beequeue to store timeout, retries, etc.
  - Do not modify directly; use job methods instead.
- `queue`: the Queue responsible for this instance of the job. This is either:
  - the queue that called `createJob` to make the job
  - the queue that called `process` to process it
- `progress`: number; progress between 0 and 100, as reported by `reportProgress`.

### Job Events
These are all Pub/Sub events like [Queue PubSub events](#queue-pubsub-events) and are disabled when `getEvents` is false.

#### succeeded
```javascript
var job = queue.createJob({...}).save();
job.on('succeeded', function (result) {
  console.log('Job ' + job.id + ' succeeded with result: ' + result);
});
```
The job has succeeded. If `result` is defined, the handler called `done(null, result)`.

#### retrying
```javascript
job.on('retrying', function (err) {
  console.log('Job ' + job.id + ' failed with error ' + err.message ' but is being retried!');
});
```
The job has failed, but it is being automatically re-enqueued for another attempt. `job.options.retries` has been decremented accordingly.

#### failed
```javascript
job.on('failed', function (err) {
  console.log('Job ' + job.id + ' failed with error ' + err.message);
});
```
The job has failed, and is not being retried.

#### progress
```javascript
job.on('progress', function (progress) {
  console.log('Job ' + job.id + ' reported progress: ' + progress + '%');
});
```
The job has sent a [progress report](#jobprototypereportprogressn) of `progress` percent.

### Methods

#### Job.prototype.retries(n)
```javascript
var job = queue.createJob({...}).retries(3).save();
```
Sets how many times the job should be automatically retried in case of failure.

Stored in `job.options.retries` and decremented each time the job is retried.

Defaults to 0.

#### Job.prototype.timeout(ms)
```javascript
var job = queue.createJob({...}).timeout(10000).save();
```
Sets a job runtime timeout; if the job's handler function takes longer than the timeout to call `done`, the worker assumes the job has failed and reports it as such.

Defaults to no timeout.

#### Job.prototype.save([cb])
```javascript
var job = queue.createJob({...}).save(function (err, job) {
  console.log('Saved job ' + job.id);
});
```
Saves a job, queueing it up for processing. After the callback fires, `job.id` will be populated.

#### Job.prototype.reportProgress(n)
```javascript
queue.process(function (job, done) {
  ...
  job.reportProgress(10);
  ...
  job.reportProgress(50);
  ...
});
```
Reports job progress when called within a handler function. Causes a `progress` event to be emitted.

### Defaults

All methods with an optional callback field will use the following default:
```javascript
var defaultCb = function (err) {
  if (err) throw err;
};
```

Defaults for Queue `settings` live in `lib/defaults.js`. Changing that file will change beequeue's default behavior.

# Under the hood

Each Queue uses the following Redis keys:
- `bq:name:id`: Integer, incremented to determine the next Job ID.
- `bq:name:jobs`: Hash from Job ID to a JSON string of its data and options.
- `bq:name:waiting`: List of IDs of jobs waiting to be processed.
- `bq:name:active`: List of IDs jobs currently being processed.
- `bq:name:succeeded`: Set of IDs of jobs which succeeded.
- `bq:name:failed`: Set of IDs of jobs which failed.
- `bq:name:stalling`: Set of IDs of jobs which haven't 'checked in' during this interval.
- `bq:name:events`: Pub/Sub channel for workers to send out job results.

beequeue is non-polling, so idle workers are listening to receive jobs as soon as they're enqueued to Redis. This is powered by [brpoplpush](http://redis.io/commands/BRPOPLPUSH), which is used to move jobs from the waiting list to the active list. beequeue generally follows the "Reliable Queue" pattern described [here](http://redis.io/commands/rpoplpush).

The `isWorker` [setting](#settings) creates an extra Redis connection dedicated to `brpoplpush`, while `getEvents` creates one dedicated to receiving Pub/Sub events. As such, these settings should be disabled if you don't need them; in most cases, only one of them needs to be enabled.

The stalling set is a snapshot of the active list from the beginning of the latest stall interval. During each stalling interval, workers remove their job IDs from the stalling set, so at the end of an interval, any jobs whose IDs are left in the stalling set have missed their window (stalled) and need to be rerun. When `checkStalledJobs` runs, it re-enqueues any jobs left in the stalling set (to the waiting list), then takes a snapshot of the active list and stores it in the stalling set.

beequeue requires the user to start the repeated checks on their own because if we did it automatically, every queue instance in the system would be doing the check. Checking from all instances is less efficient and provides weaker guarantees than just checking from one or two. For example, a `checkStalledJobs` interval of 5000ms running on 10 processes would average one check every 500ms, but would only guarantee a check every 5000ms. Two instances checking every 1000ms would also average one check every 500ms, but would be more well-distributed across time and would guarantee a check every 1000ms. Though the check is not expensive, and it doesn't hurt to do it extremely often, avoiding needless inefficiency is a main point of this library, so we leave it to the user to control exactly which processes are doing the check and how often.

# Contributing

Pull requests are welcome; just make sure `grunt test` passes. For significant changes, open an issue for discussion first.

Some significant non-features include:
- Job scheduling: This forked project did this.
- Worker tracking: Kue does this.
- All-workers pause-resume: Bull does this.
- Web interface:  Kue has a nice one built in, and someone made [one for Bull](https://github.com/ShaneK/Matador).
- Job priority: multiple queues get the job done in simple cases, but Kue has first-class support. Bull provides a wrapper around multiple queues.

Some of these could be worthwhile additions; please comment if you're interested in using or helping implement them!

You'll need a local redis server to run the tests. Note that running them will delete any keys that start with `bq:test:`.

[npm-image]: https://img.shields.io/npm/v/beequeue.svg?style=flat
[npm-url]: https://www.npmjs.com/package/beequeue
[travis-image]: https://img.shields.io/travis/LewisJEllis/beequeue.svg?style=flat
[travis-url]: https://travis-ci.org/LewisJEllis/beequeue
[coveralls-image]: https://coveralls.io/repos/LewisJEllis/beequeue/badge.svg?branch=master
[coveralls-url]: https://coveralls.io/r/LewisJEllis/beequeue?branch=master
