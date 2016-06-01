// Effectively _.after
var barrier = function (n, done) {
  return function () {
    n -= 1;
    if (n === 0) {
      done();
    }
  };
};

var defaultCb = function (err) {
  if (err) {
    throw err;
  }
};

var restartOnError = function(client, tick) {
	var restart = function() {
		client.on('ready', tick);
	};
	client.on('error', restart);
	client.on('end', restart);
};

module.exports = {
  barrier: barrier,
  defaultCb: defaultCb,
	restartOnError: restartOnError
};
