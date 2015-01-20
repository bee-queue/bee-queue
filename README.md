# Bee Queue

A simple, fast, robust job/task queue, backed by Redis.

  [![NPM Version][npm-image]][npm-url]
  [![Build Status][travis-image]][travis-url]

```javascript
var Queue = require('bee-queue');
var testQueue = new Queue('test');

testQueue.process(function (job, done) {
  console.log('processing job ' + job.jobId);
  console.log('the sum is: ' + (job.data.x + job.data.y));
  done();
});

var reportEnqueued = function (err, job) {
  console.log('enqueued job ' + job.jobId);
};

testQueue.add({x: 1, y: 1}, reportEnqueued);
testQueue.add({x: 1, y: 2}, reportEnqueued);

setTimeout(testQueue.add.bind(testQueue, {x: 1, y: 3}, reportEnqueued), 1500);

```

Bee Queue: a simple, fast, robust job/task queue, backed by Redis.

- Simple: ~500 LOC, and the only dependency is [node-redis](https://github.com/mranney/node_redis).
- Fast: uses Lua scripting and pipelining whenever possible; numbers, benchmarks, etc to come.
- Robust: well-tested, designed to withstand failures and avoid race conditions.

Heavily inspired by [Bull](https://github.com/OptimalBits/bull), which was an invaluable reference during development. More comparisons/explanations to come.

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
Queue(name, settings)
Queue.add(data, cb(err, job))
Queue.process(handler(job, done))
```

The constructor settings can take the following fields:
- `host`: redis host
- `port`: redis port
- `socket`: provide a socket path instead of a host and port
- `db`: redis DB index
- `options`: options object for [node-redis](https://github.com/mranney/node_redis#rediscreateclient)

# Contributing
Pull requests are welcome; just make sure `grunt test` passes.

You'll need a local redis server to run the tests. Note that running them will delete any keys that start with `bq:test:`.

[npm-image]: https://img.shields.io/npm/v/bee-queue.svg?style=flat
[npm-url]: https://www.npmjs.com/package/bee-queue
[travis-image]: https://img.shields.io/travis/LewisJEllis/bee-queue.svg?style=flat
[travis-url]: https://travis-ci.org/LewisJEllis/bee-queue
