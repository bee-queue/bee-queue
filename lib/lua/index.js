'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const helpers = require('../helpers');

const promisify = require('promise-callbacks').promisify;

const scripts = {};
const shas = {};
let scriptsRead = false;
let scriptsPromise = null;

const readFile = promisify.methods(fs, ['readFile']).readFile;
const readDir = promisify.methods(fs, ['readdir']).readdir;

function readScript(file) {
  return readFile(path.join(__dirname, file), 'utf8').then((script) => {
    const name = file.slice(0, -4);
    scripts[name] = script;
    const hash = crypto.createHash('sha1');
    hash.update(script);
    shas[name] = hash.digest('hex');
  });
}

function readScripts() {
  if (scriptsRead) return scriptsPromise;
  scriptsRead = true;
  return (scriptsPromise = readDir(__dirname)
    .then((files) =>
      Promise.all(files.filter((file) => file.endsWith('.lua')).map(readScript))
    )
    .then(() => scripts));
}

function loadScriptIfMissing(client, scriptKey) {
  return helpers
    .callAsync((done) => client.script('exists', shas[scriptKey], done))
    .then((exists) =>
      exists[0] === 0
        ? helpers.callAsync((done) =>
            client.script('load', scripts[scriptKey], done)
          )
        : null
    );
}

function buildCache(client) {
  // We could theoretically pipeline this, but it's pretty insignificant.
  return readScripts().then(() =>
    Promise.all(
      Object.keys(shas).map((key) => loadScriptIfMissing(client, key))
    )
  );
}

module.exports = {
  scripts,
  shas,
  buildCache,
};
