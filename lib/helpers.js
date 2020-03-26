'use strict';

const hasOwn = Object.prototype.hasOwnProperty;

function has(object, name) {
  return hasOwn.call(object, name);
}

// A simple way to get 13 statistically random hex digits, not cryptographic
const MAX_SAFE_NYBBLE = 13; // low-order 52 bits of double mantissa's 53 bits
const randomHex13 = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
  .toString(16)
  .padStart(MAX_SAFE_NYBBLE, '0')
  .slice(-MAX_SAFE_NYBBLE);

const promiseUtils = require('promise-callbacks');

module.exports = {
  asCallback: promiseUtils.asCallback,
  deferred: promiseUtils.deferred,
  delay: promiseUtils.delay,
  waitOn: promiseUtils.waitOn,
  withTimeout: promiseUtils.withTimeout,
  wrapAsync: promiseUtils.wrapAsync,
  has,
  randomHex13,
};
