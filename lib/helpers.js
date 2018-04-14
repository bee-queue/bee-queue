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

module.exports = {
  delay,
  waitOn,
  withTimeout,
};
