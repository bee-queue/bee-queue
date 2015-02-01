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

module.exports = {
  barrier: barrier,
  defaultCb: defaultCb
};
