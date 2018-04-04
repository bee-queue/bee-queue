'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const { promisify } = require('util');

const scripts = {};
const shas = {};
let scriptsRead = false;
let scriptsPromise = null;

const readFile = promisify(fs.readFile);
const readDir = promisify(fs.readdir);

async function readScript(file) {
  const script = await readFile(path.join(__dirname, file), 'utf8');
  const name = file.slice(0, -4);
  scripts[name] = script;
  const hash = crypto.createHash('sha1');
  hash.update(script);
  shas[name] = hash.digest('hex');
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

async function loadScriptIfMissing(client, scriptKey) {
  const [exists] = await client.script('exists', shas[scriptKey]);
  if (exists !== 0) return null;
  return client.script('load', scripts[scriptKey]);
}

async function buildCache(client) {
  // We could theoretically pipeline this, but it's pretty insignificant.
  await readScripts();
  await Promise.all(
    Object.keys(shas).map((key) => loadScriptIfMissing(client, key))
  );
}

module.exports = {
  scripts,
  shas,
  buildCache,
};
