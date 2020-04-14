'use strict';

const hasOwn = Object.prototype.hasOwnProperty;

function has(object, name) {
  return hasOwn.call(object, name);
}

/**
 * A variant of the Promise#finally implementation. Instead of rejecting with
 * the error that occurs in the finally clause, it rejects with the error from
 * the original Promise first, and falls back to using the error from the
 * finally clause if no such error occurred.
 */
function finallyRejectsWithInitial(promise, fn) {
  return promise.then(
    (value) => Promise.resolve(fn()).then(() => value),
    (err) => {
      const reject = () => Promise.reject(err);
      return new Promise((resolve) => resolve(fn())).then(reject, reject);
    }
  );
}

const promiseUtils = require('promise-callbacks');

module.exports = {
  asCallback: promiseUtils.asCallback,
  callAsync: promiseUtils.callAsync,
  deferred: promiseUtils.deferred,
  delay: promiseUtils.delay,
  finallyRejectsWithInitial,
  has,
  waitOn: promiseUtils.waitOn,
  withTimeout: promiseUtils.withTimeout,
  wrapAsync: promiseUtils.wrapAsync,
};
