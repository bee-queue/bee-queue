'use strict';

function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

// borrowed/adapted from promise-callbacks
function waitOn(emitter, event) {
  return new Promise((resolve, reject) => {
    function unbind() {
      emitter.removeListener('error', onError);
      emitter.removeListener(event, onEvent);
    }

    function onEvent(value) {
      unbind();
      resolve(value);
    }

    function onError(err) {
      unbind();
      reject(err);
    }

    emitter.on('error', onError);
    emitter.on(event, onEvent);
  });
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

// shamelessly stolen from promise-callbacks
function withTimeout(promise, timeLimit, message) {
  let timeout;
  const timeoutPromise = new Promise((resolve, reject) => {
    // Instantiate the error here to capture a more useful stack trace.
    const error =
      message instanceof Error
        ? message
        : new Error(message || 'Operation timed out.');
    timeout = setTimeout(reject, timeLimit, error);
  });
  // lol classic case of wanting `Promise.prototype.finally` right here
  return Promise.race([promise, timeoutPromise]).then(
    (value) => {
      clearTimeout(timeout);
      return value;
    },
    (err) => {
      clearTimeout(timeout);
      throw err;
    }
  );
}

class Defer {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

function* zip(...iterables) {
  const iterators = iterables.map((iter) => iter[Symbol.iterator]());
  for (;;) {
    let isDone = 0;
    const item = iterators.map((iter) => {
      const { value, done } = iter.next();
      isDone += done;
      return value;
    });
    if (isDone) {
      if (isDone === iterators.length) break;
      throw new Error('mismatched iterable lengths');
    }
    yield item;
  }
}

module.exports = {
  defer: () => new Defer(),
  delay,
  finallyRejectsWithInitial,
  waitOn,
  withTimeout,
  zip,
};
