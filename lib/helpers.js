'use strict';

const arraySlice = Array.prototype.slice;

function toArray(arrayLike) {
  return arraySlice.call(arrayLike);
}

const promiseUtils = require('promise-callbacks');

module.exports = {
  asCallback: promiseUtils.asCallback,
  deferred: promiseUtils.deferred,
  delay: promiseUtils.delay,
  waitOn: promiseUtils.waitOn,
  withTimeout: promiseUtils.withTimeout,
  wrapAsync: promiseUtils.wrapAsync,
  toArray,
};
