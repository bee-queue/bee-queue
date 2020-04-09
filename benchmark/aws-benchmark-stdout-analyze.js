// A quick and dirty analysis script for computing the output of ./aws-benchmark.js

const fs = require('fs');

const lines = fs.readFileSync('output.txt').toString().split('\n');

const results = {};

let queue, concurrency;

lines.forEach((line) => {
  // If this line is in format: bq-0@1 [6.9.1 #1] {redis 3.2.10}
  const queueDescription = line.match(/^(.+)@(\d+)/);
  if (queueDescription) {
    queue = queueDescription[1];
    concurrency = queueDescription[2];
  }

  // If it's a line with purely digits, assume it's the time printed by the script.
  const result = line.match(/^\d+$/);
  if (result) {
    if (!results[queue]) results[queue] = {};
    if (!results[queue][concurrency]) results[queue][concurrency] = [];
    results[queue][concurrency].push(parseInt(result));
  }
});

Object.keys(results).forEach((queueName) => {
  Object.keys(results[queueName]).forEach((c) => {
    const values = results[queueName][c];
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    console.log(`${queueName} ${c} ${Math.round(avg)}`);
  });
});
