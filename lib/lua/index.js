var fs = require('fs');
var crypto = require('crypto');

var scripts = {};
var shas = {};

fs.readdirSync('./lib/lua').forEach(function (file) {
  if (file === 'index.js') {
    return;
  }
  var hash = crypto.createHash('sha1');
  var key = file.slice(0, -4);
  scripts[key] = fs.readFileSync('./lib/lua/' + file).toString();
  hash.update(scripts[key]);
  shas[key] = hash.digest('hex');
});

module.exports = {
  scripts: scripts,
  shas: shas
};
