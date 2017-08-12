// A quick and dirty analysis script for the data in results-*.json.

const _ = require('underscore');
const results = require('./results-2017-08-12.json');

function stats(objects, iteratee) {
  iteratee = _.iteratee(iteratee);
  const values = objects.map(iteratee);
  values.sort((a, b) => a - b);
  return {
    min: _.first(values),
    max: _.last(values),
    median: values[values.length >> 1],
    mean: values.reduce((n, v) => n + v, 0) / values.length,
    count: values.length
  };
}

function formatted(objects, iteratee) {
  const {min, max, median, mean} = stats(objects, iteratee);
  return `[${min} :: ${max} {median: ${median}, mean: ${mean.toFixed(1)}}]`;
}

function mapped(map, indent, iteratee) {
  iteratee = _.iteratee(iteratee);
  const lines = Object.keys(map);
  const isNumeric = /^\d+$/.test(lines[0]);
  const maxLen = lines.reduce((v, s) => Math.max(v, s.length), 0);
  lines.sort(isNumeric ? (a, b) => a - b : (a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  return lines.map((key) => {
    return `${indent}${key.padStart(maxLen, ' ')} => ${iteratee(map[key])}`;
  }).join('\n');
}

function* partitions(array) {
  for (let [index, value] of array.entries()) {
    yield [value, array.slice(index + 1)];
  }
}

function* permuteMany(array, size, pre) {
  if (size === 0) {
    for (let value of array) {
      yield [...pre, value];
    }
    return;
  }
  for (let [value, rest] of partitions(array)) {
    yield* permuteMany(rest, size - 1, [...pre, value]);
  }
}

function permute(array, size) {
  if (size === 0) return [[]];
  return permuteMany(array, size - 1, []);
}

function tieredGroup(array, keys, iteratee, indent = 0) {
  if (!keys.length) return formatted(array, iteratee);
  const grouped = _.groupBy(array, keys[0]), tiered = {};
  for (let key in grouped) {
    tiered[key] = tieredGroup(grouped[key], keys.slice(1), iteratee, indent + 2);
  }
  return mapped(tiered, '  '.repeat(indent), keys.length === 1 ? undefined : (z) => `\n${z}`);
}

function grok(array, keys, iteratee, maxDepth = 2) {
  for (let depth = 0; depth <= maxDepth; ++depth) {
    for (let pKeys of permute(keys, depth)) {
      const grouped = tieredGroup(array, pKeys, iteratee);
      console.log(pKeys.join(', '));
      console.log(grouped);
    }
  }
}

grok(results, ['nodeVersion', 'library', 'concurrency'], 'duration');
