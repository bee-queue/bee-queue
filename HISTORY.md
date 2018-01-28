1.2.2 / 2018-01-25
==================

  * Update Typescript type definitions (thanks @brickyang for #98).

1.2.1 / 2018-01-15
==================

  * Update Typescript type definitions (thanks @brickyang for #94).

1.2.0 / 2018-01-10
==================

  * Add Typescript type definitions (thanks @pbadenski for #80 and @martinwepner for #89).

1.1.0 / 2017-08-12
==================

  * Support sharing the redis command client between Queues.
  * Add documentation, add tests for expected behavior.

1.0.0 / 2017-06-30
==================

  * Upgrade node-redis to 2.7.1
    Note that redis connection options now match the latest redis.
  * Implement delayed jobs
  * Implement fixed, exponential backoff strategies
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
