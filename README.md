# Bee Queue

A simple, fast, robust job/task queue, backed by Redis.

  [![NPM Version][npm-image]][npm-url]
  [![Build Status][travis-image]][travis-url]

```javascript
var Queue = require('bee-queue');
var queue = new Queue('test');

queue.on('ready', function () {
  queue.process(function (job, done) {
    console.log('processing job ' + job.id);
    console.log('the sum is: ' + (job.data.x + job.data.y));
    done();
  });

  var reportEnqueued = function (err, job) {
    console.log('enqueued job ' + job.id);
  };

  queue.add({x: 1, y: 1}, reportEnqueued);
  queue.add({x: 1, y: 2}, reportEnqueued);
  setTimeout(queue.add.bind(queue, {x: 1, y: 3}, reportEnqueued), 500);
});
```

Bee Queue: a simple, fast, robust job/task queue, backed by Redis.

- Simple: ~400 LOC, and the only dependency is [node-redis](https://github.com/mranney/node_redis).
- Fast: uses Lua scripting and pipelining whenever possible; numbers, benchmarks, etc to come.
- Robust: well-tested, designed to withstand failures and avoid race conditions.

Currently a bit raw, but 1.0.0 (and thorough docs/explanations/benchmarks/comparisons) should come soon.

Heavily inspired by [Bull](https://github.com/OptimalBits/bull), which was an invaluable reference during development.

Why Bees? Bee Queue is like a bee because it:
- carries pollen (messages) between flowers (servers)
- is small and simple
- is fast (bees can fly 20mph!)
- doesn't sting you as much as wasps do

# Installation
```
npm install bee-queue
```

# Methods
```
Queue(name[, settings])
Queue.add(data[, cb(err, job)])
Queue.process([maxRunning,] handler(job, done(err)))
```

The constructor's settings argument is an object which can take the following fields:
- `host`: redis host
- `port`: redis port
- `socket`: provide a socket path instead of a host and port
- `db`: redis DB index
- `options`: options object for [node-redis](https://github.com/mranney/node_redis#rediscreateclient)
- `stallInterval`: ms, default 5000. The length of the window in which workers must report that they aren't stalling; higher values will reduce redis network overhead, but if a worker gets stuck, it will take longer before its stalled job gets retried.
- `globalKeyPrefix`: string, default 'bq'. Configurable just in case the `bq:` namespace is, for whatever reason, unavailable on your redis database.
- `catchExceptions`: boolean, default false. Whether to catch exceptions thrown by the handler given to `Queue.process`; only set to true if you must rely on throwing exceptions and having them be caught. Otherwise, communicate errors via `done(err)`.

The process function's `maxRunning` parameter sets the maximum number of simultaneously active jobs, defaulting to 1.

The handler's `done` callback should only be called once. The handler function should never throw an exception, unless `catchExceptions` has been enabled.

It's analogous to [kue's processing concurrency](https://github.com/LearnBoost/kue#processing-concurrency). However, `bee-queue` will use only two Redis connections, while kue (and the equivalent in bull, using `maxRunning` instances of the same queue) will use `2 * maxRunning` connections.

# Contributing
Pull requests are welcome; just make sure `grunt test` passes.

You'll need a local redis server to run the tests. Note that running them will delete any keys that start with `bq:test:`.

[npm-image]: https://img.shields.io/npm/v/bee-queue.svg?style=flat
[npm-url]: https://www.npmjs.com/package/bee-queue
[travis-image]: https://img.shields.io/travis/LewisJEllis/bee-queue.svg?style=flat
[travis-url]: https://travis-ci.org/LewisJEllis/bee-queue
