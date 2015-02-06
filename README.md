# Bee Queue [![NPM Version][npm-image]][npm-url] [![Build Status][travis-image]][travis-url] [![Coverage Status][coveralls-image]][coveralls-url]

A simple, fast, robust job/task queue for Node.js, backed by Redis.
- Simple: ~500 LOC, and the only dependency is [node_redis](https://github.com/mranney/node_redis).
- Fast: minimizes Redis overhead to maximize throughput.
- Robust: designed with failure in mind, 100% code coverage

```javascript
var Queue = require('bee-queue');
var queue = new Queue('example');

var job = queue.createJob({x: 2, y: 3}).save();
job.on('succeeded', function (result) {
  console.log('Received result for job ' + job.id + ': ' + result);
});

queue.process(function (job, done) {
  console.log('Processing job ' + job.id);
  return done(null, job.data.x + job.data.y);
});

```

# Overview
- Create, save, and process jobs
- Concurrent processing
- Job timeouts and retries
- Job events via Pub/Sub
  - Progress reporting
  - Return results from jobs
- Robust design
  - Strives for all atomic operations
  - Retries [stuck jobs](#under-the-hood)
- Performance-focused
  - Keeps [Redis usage](#under-the-hood) to the bare minimum.
  - Uses Lua scripting and pipelining to minimize network overhead
  - Benchmarks (coming soon)
- 100% code coverage

# Installation
```
npm install bee-queue
```
You'll also need [Redis 2.8+](http://redis.io/topics/quickstart) running somewhere.

# Table of Contents
- [Why Bee-Queue?](#why-bee-queue)
  - [Missing Features](#missing-features)
  - [Why Bees?](#why-bees)
- [Creating Jobs]()
- [Processing Jobs]()
- [Progress Reporting]()
- [Job Events]()
- [Queue Events]()
- [API Reference](#api-reference)
  - [Queue](#queuename-job)
  - [Job](#job)
- [Under The Hood](#under-the-hood)

# Why Bee-Queue?
[Kue](https://github.com/LearnBoost/kue) and [Bull](https://github.com/OptimalBits/bull) already exist, and they're good at what they do, so why does Bee-Queue also need to exist?

In short: Kue has some good stuff, and Bull has some good stuff, but we needed to mix and match the good stuff, and we needed to squeeze out more performance.

Bee-Queue starts by combining Bull's simplicity and robustness with Kue's ability to send events back to job creators, then focuses heavily on performance, and finishes by being strict about [code quality](https://github.com/LewisJEllis/bee-queue/blob/master/.eslintrc) and [testing](https://coveralls.io/r/LewisJEllis/bee-queue?branch=master). It compromises on breadth of features, so there are certainly cases where Kue or Bull might be preferable (see below).

Bull and Kue do things really well and deserve a lot of credit. Bee-Queue borrows ideas from both, and Bull was an especially invaluable reference during initial development.

A more detailed writeup on Bee-Queue's origin and motivating factors can be found [here](https://github.com/LewisJEllis/bee-queue/wiki/Origin).

### Missing Features
- Job scheduling: Kue and Bull do this.
- Worker tracking: Kue does this.
- All-workers pause-resume: Bull does this.
- Web interface:  Kue has a nice one built in, and someone made [one for Bull](https://github.com/ShaneK/Matador).
- Job priority: multiple queues get the job done in simple cases, but Kue has first-class support. Bull provides a wrapper around multiple queues.

Some of these are potential future additions; please comment if you're interested in any of them!

#### Why Bees?
Bee-Queue is like a bee because it:
- is small and simple
- is fast (bees can fly 20mph!)
- carries pollen (messages) between flowers (servers)
- something something "worker bees"

# API Reference

## Defaults

All methods with an optional callback field will use the following default:
```javascript
var defaultCb = function (err) {
  if (err) {
    throw err;
  }
};
```

Defaults for Queue `settings` live in `lib/defaults.js`. Changing that file will change Bee-Queue's default behavior.

## Queue

### Properties
- `name`: the name passed to the constructor.
- `paused`: boolean, whether the queue is paused.
- `settings`: the settings as resolved between the settings passed and the defaults.

### Events

#### ready
```javascript
queue.on('ready', function () {
  console.log('queue now ready to start doing things');
});
```
The queue has connected to Redis and ensured that Lua scripts are cached.

#### succeeded
```javascript
queue.on('succeeded', function (job, result) {
  console.log('')
});
```
This queue instance has successfully processed `job`. If `result` is defined, the handler called `done(null, result)`.

#### failed

#### error
```javascript
queue.on('error', function (err) {
  console.log('A queue error happened: ' + err.message);
});
```
Any Redis errors are re-emitted from the Queue.

### Methods

#### Queue(name, [settings])

Used to instantiate a new queue; opens connections to Redis.

The default settings are as follows:
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
- `prefix`: string, default 'bq'. Useful if the `bq:` namespace is, for whatever reason, unavailable on your redis database.
- `stallInterval`: Milliseconds; the length of the window in which workers must report that they aren't stalling. Higher values will reduce Redis/network overhead, but if a worker stalls, it will take longer before its stalled job(s) will be retried.
- `redis`: Object, specifies how to connect to Redis.
  - `host`: String, Redis host.
  - `port`: Number, Redis port.
  - `socket`: String, Redis socket to be used instead of a host and port.
  - `db`: Number, Redis [DB index](http://redis.io/commands/SELECT).
  - `options`: Options object, passed to [node_redis](https://github.com/mranney/node_redis#rediscreateclient).
- `isWorker`: boolean, default true. Disable if this queue will not process jobs.
- `getEvents`: boolean, default true. Disable if this queue does not need to receive job events.
- `sendEvents`: boolean, default true. Disable if this worker does not need to send job events back to other queues.
- `removeOnSuccess`: boolean, default false. Enable to keep memory usage down by automatically removing jobs from Redis when they succeed.
- `catchExceptions`: boolean, default false. Only enable if you want exceptions thrown by the [handler](TODO LINK) to be caught by Bee-Queue and interpreted as job failures. Communicating failures via `done(err)` is preferred.

#### Queue.createJob(data)
```javascript
var job = queue.createJob({...});
```
Returns a new [Job object](#job) with the associated [user data](#job).

#### Queue.process([maxRunning], handler(job, done))

Begins processing jobs with the provided handler function.

This function should only be called once, and should never be called on a queue where `isWorker` is false.

The optional `concurrency` parameter sets the maximum number of simultaneously active jobs for this processor. It defaults to 1.

The handler function should:
- Call `done` exactly once
  - Use `done(err)` to indicate job failure
  - Use `done()` or `done(null, result)` to indicate job success
- Never throw an exception, unless `catchExceptions` has been enabled.
- Never ever [block](http://www.slideshare.net/async_io/practical-use-of-mongodb-for-nodejs/47) [the](http://blog.mixu.net/2011/02/01/understanding-the-node-js-event-loop/) [event](http://strongloop.com/strongblog/node-js-performance-event-loop-monitoring/) [loop](http://zef.me/blog/4561/node-js-and-the-case-of-the-blocked-event-loop) (for very long). If you do, the stall detection might think the job stalled, when it was really just blocking the event loop.

#### Queue.checkStalledJobs([cb])

#### Queue.close([cb])

## Job

### Properties
- `id`: number, Job ID unique to each job. Not populated until `.save` calls back.
- `data`: object; user data associated with the job. It should:
  - Be JSON-serializable (for `JSON.stringify`)
  - Never be used to pass large pieces of data (100kB+)
  - Ideally be as small as possible (1kB or less)
- `options`: object used by Bee-Queue to store timeout, retries, etc.
  - Do not modify directly; use job methods instead.
- `queue`: the Queue responsible for this instance of the job. This will either:
  - the queue that called `createJob` to make the job
  - the queue that called `process` to process it
- `progress`: number; progress between 0 and 100, as reported by `reportProgress`.

### Events
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
The job has failed, but it is being automatically re-enqueued for another attempt.

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
The job has sent a [progress report](TODO LINK) of `progress` percent.

### Methods

#### Job.retries(n)
```javascript
var job = queue.createJob({...}).retries(3).save();
```
Sets how many times the job should be automatically retried in case of failure.

Defaults to 0.

#### Job.timeout(ms)
```javascript
var job = queue.createJob({...}).timeout(10000).save();
```
Sets a job runtime timeout; if the job's handler function takes longer than the timeout to call `done`, the worker assumes the job has failed and reports it as such.

Defaults to no timeout.

#### Job.save([cb])
```javascript
var job = queue.createJob({...}).save(function (err, job) {
  console.log('Saved job ' + job.id);
});
```
Saves a job, queueing it up for processing. After the callback fires, `job.id` will be populated.

#### Job.reportProgress(n)
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

Jobs are moved from the waiting list to the active list using [brpoplpush](http://redis.io/commands/BRPOPLPUSH), and Bee-Queue generally follows the "Reliable Queue" pattern described on the [rpoplpush page](http://redis.io/commands/rpoplpush).

The `isWorker` [setting](TODO LINK) creates an extra Redis connection dedicated to `brpoplpush`, while `getEvents` creates one for subscribing to Pub/Sub events. As such, these settings should be disabled if you don't need them. In most cases, only one of them needs to be true.

The stalling set is a snapshot of the active list from the beginning of the latest stall interval. During each stalling interval, workers remove their job IDs from the stalling set, so at the end of an interval, any jobs IDs left in the stalling set have missed their window (stalled) and need to be rerun. When `checkStalledJobs` runs, it re-enqueues any jobs left in the stalling set (to the waiting list), then takes a snapshot of the active list and stores it in the stalling set.

# Contributing
Pull requests are welcome; just make sure `grunt test` passes. For significant changes, open an issue for discussion first.

You'll need a local redis server to run the tests. Note that running them will delete any keys that start with `bq:test:`.

[npm-image]: https://img.shields.io/npm/v/bee-queue.svg?style=flat
[npm-url]: https://www.npmjs.com/package/bee-queue
[travis-image]: https://img.shields.io/travis/LewisJEllis/bee-queue.svg?style=flat
[travis-url]: https://travis-ci.org/LewisJEllis/bee-queue
[coveralls-image]: https://coveralls.io/repos/LewisJEllis/bee-queue/badge.svg?branch=master
[coveralls-url]: https://coveralls.io/r/LewisJEllis/bee-queue?branch=master
