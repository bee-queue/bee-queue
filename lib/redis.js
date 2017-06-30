const redis = require('redis');
const helpers = require('./helpers');

function createClient(settings) {
  // node_redis mutates the options object we provide it.
  if (settings && typeof settings === 'object') {
    settings = Object.assign({}, settings);
  }

  const client = redis.createClient(settings);

  // Wait for the client to be ready, then resolve with the client itself.
  return helpers.waitOn(client, 'ready', true)
    .then(() => client);
}

exports.createClient = createClient;
