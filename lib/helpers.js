'use strict';

const hasOwn = Object.prototype.hasOwnProperty;

function has(object, name) {
  return hasOwn.call(object, name);
}

const promiseUtils = require('promise-callbacks');

module.exports = {
  asCallback: promiseUtils.asCallback,
  deferred: promiseUtils.deferred,
  delay: promiseUtils.delay,
  waitOn: promiseUtils.waitOn,
  withTimeout: promiseUtils.withTimeout,
  wrapAsync: promiseUtils.wrapAsync,
  has,
};
