var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var barrier = require('../helpers').barrier;

var scripts = {};
var shas = {};
var scriptsRead = false;
var cachedServers = {};

var readScripts = function () {
  fs.readdirSync(__dirname)
    .filter(function (file) {
      return file.slice(-4) === '.lua';
    }).forEach(function (file) {
      var hash = crypto.createHash('sha1');
      var key = file.slice(0, -4);
      scripts[key] = fs.readFileSync(path.join(__dirname, file)).toString();
      hash.update(scripts[key]);
      shas[key] = hash.digest('hex');
    });
  scriptsRead = true;
};

var buildCache = function (serverKey, client, cb) {
  if (cachedServers[serverKey]) {
    return cb();
  }

  if (!scriptsRead) {
    readScripts();
  }

  var reportLoaded = barrier(Object.keys(shas).length, function () {
    cachedServers[serverKey] = true;
    return cb();
  });

  Object.keys(shas).forEach(function (key) {
    client.script('exists', shas[key], function (err, exists) {
      /* istanbul ignore if */
      if (err) {
        client.emit('error', 'Could not build Lua script cache');
      } else if (exists[0] === 0) {
        client.script('load', scripts[key], reportLoaded);
      } else {
        reportLoaded();
      }
    });
  });
};

module.exports = {
  scripts: scripts,
  shas: shas,
  buildCache: buildCache
};
