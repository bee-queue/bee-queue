let logger = require('morgan');
let express = require('express');
let app = express();
app.use(logger('dev'));

let Queue = require('../../');
let queue = Queue('express-example');

app.get('/run/:x/:y', function (req, res) {
  let job = queue.createJob({
    x: req.params.x,
    y: req.params.y
  });

  job.on('succeeded', function (result) {
    console.log('completed job ' + job.id);
    res.send('output: ' + result);
  });

  job.save(function (err, job) {
    if (err) {
      console.log('job failed to save');
      return res.send('job failed to save');
    }
    console.log('saved job ' + job.id);
  });
});

var server = app.listen(3000, function () {
  let host = server.address().address;
  let port = server.address().port;
  console.log('Example app listening at http://%s:%s', host, port);
});
