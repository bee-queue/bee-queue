require('chai').config.includeStack = true;

process.on('unhandledRejection', (err) => {
  throw err;
});
