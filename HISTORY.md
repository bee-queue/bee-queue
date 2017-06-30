1.0.0 / 2017-06-30
==================

  * Upgrade node-redis to 2.7.1
    Note that redis connection options now match the latest redis.
  * Implement delayed jobs
  * Implement fixed, expontential backoff strategies
  * Add promise support
  * Fix race conditions in tests
  * Add new performance settings
  * Emit stalled event for stalled jobs
  * Implement graceful shutdown
  * Support user-specified jobids (should be non-numeric)
  * Add timeout, stacktraces to job options

0.3.0 / 2015-09-01
==================

  * Bump node-redis dependency to 1.0.0

0.2.0 / 2015-06-12
==================

  * Initial release

0.1.0 / 2015-01-26
==================

  * Early development
