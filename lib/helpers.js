// Effectively _.after
var barrier = function (n, done) {
  return function () {
    n -= 1;
    if (n === 0) {
      done();
    }
  };
};

module.exports = {
  barrier: barrier
};
