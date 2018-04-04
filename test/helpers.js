const { delay, waitOn, deferred } = require('promise-callbacks');

// A promise-based barrier.
function reef(n = 1) {
  let next;
  const done = new Promise((resolve) => {
    next = () => {
      --n;
      if (n < 0) return false;
      if (n === 0) resolve();
      return true;
    };
  });
  return { done, next };
}

async function delKeys(client, pattern) {
  const keys = await client.keys(pattern);
  if (keys.length) {
    await client.del(keys);
  }
}

module.exports = {
  reef,
  delKeys,
  deferred,
  delay,
  waitOn,
};
