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

function immediateThen(promiseOrValue, fn) {
  return promiseOrValue && typeof promiseOrValue.then === 'function'
    ? promiseOrValue.then(fn)
    : fn(promiseOrValue);
}

function emitHandleErrors(emitter, args) {
  try {
    emitter.emit.apply(emitter, args);
  } catch (err) {
    emitter.emit('error:user', err) ||
      // It's not easy to capture uncaught exceptions in ava.
      /* istanbul ignore next: just use the error:user event */
      process.nextTick(() => {
        /* istanbul ignore next */
        throw err;
      });
  }
}

const promiseUtils = require('promise-callbacks');

module.exports = {
  asCallback: promiseUtils.asCallback,
  callAsync: promiseUtils.callAsync,
  defer: promiseUtils.defer,
  delay: promiseUtils.delay,
  emitHandleErrors,
  finallyRejectsWithInitial,
  promisify: promiseUtils.promisify,
  has,
  immediateThen,
  waitOn: promiseUtils.waitOn,
  withTimeout: promiseUtils.withTimeout,
  wrapAsync: promiseUtils.wrapAsync,
};
