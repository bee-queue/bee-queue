require('./harness')({
  numRuns: 10000,
  concurrency: 1
}, function (err, time) {
  console.log('Ran 10000 jobs through Bull with concurrency 1 in %d ms', time);
});
