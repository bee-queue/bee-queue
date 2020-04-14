const logger = require('morgan');
const express = require('express');
const app = express();
app.use(logger('dev'));

const Queue = require('../../');
const queue = Queue('express-example');

app.get('/run/:x/:y', function (req, res) {
  const job = queue.createJob({
    x: req.params.x,
    y: req.params.y,
  });

  job.on('succeeded', function (result) {
    console.log('completed job ' + job.id);
    res.send('output: ' + result);
  });

  job.save(function (err) {
    if (err) {
      console.log('job failed to save');
      return res.send('job failed to save');
    }
    console.log('saved job ' + job.id);
  });
});

const server = app.listen(3000, function () {
  const host = server.address().address;
  const port = server.address().port;
  console.log('Example app listening at http://%s:%s', host, port);
});
