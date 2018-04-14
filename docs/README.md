---
home: true
heroImage: /logo.png
actionText: Get Started →
actionLink: /guide/
features:
- title: Simple
  details: Under 1000 lines of code, and the only dependency is the Redis client.
- title: Fast
  details: Maximizes throughput by minimizing Redis usage and network overhead. Leads performance benchmarks.
- title: Robust
  details: Designed with concurrency, atomicity, and failure in mind. Each line of code has two lines of tests.
- title: Runs At Scale
  details: Mixmax's back end uses Bee-Queue to process over a billion jobs every week. Read their <a href="https://mixmax.com/blog/bee-queue-v1-node-redis-queue" target="_blank">blog post.</a>
- title: Modern JavaScript API
  details: A fluent interface for adding timeouts, retry policies, and delayed execution. Works great with async/await.
- title: Widely Used
  details: Over 20,000 downloads per month. Read about <a href="/users/">who's using Bee-Queue</a>.

footer: MIT Licensed | Copyright © 2015-present Lewis Ellis
---

### Simple Getting Started:

Install:
```bash
npm install bee-queue 
```

Enqueue a job:
```javascript
const Queue = require('bee-queue');
const queue = new Queue('example');

queue.createJob({x: 2, y: 3}).save().then(job => {
  job.on('succeeded', (result) => {
    console.log(`Received result for job ${job.id}: ${result}`);
  });
});
```

Process jobs from anywhere:
```javascript
const Queue = require('bee-queue');
const queue = new Queue('example');

queue.process(async (job) => {
  console.log(`Processing job ${job.id}`);
  return job.data.x + job.data.y;
});
```
