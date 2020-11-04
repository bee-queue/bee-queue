### [1.3.1](https://github.com/bee-queue/bee-queue/compare/v1.3.0...v1.3.1) (2020-11-04)

### Bug Fixes

- **scale:** bound unpack arguments count ([#297](https://github.com/bee-queue/bee-queue/issues/297)) ([4108e5e](https://github.com/bee-queue/bee-queue/commit/4108e5e4e97dcf2d8df44dd0114ba31edab511ca))
- **types:** fix typescript definitions errors ([#311](https://github.com/bee-queue/bee-queue/issues/311)) ([3bc3f31](https://github.com/bee-queue/bee-queue/commit/3bc3f317d09a04b1165fc9f3aa46e17e82d3606f))

## [1.3.0](https://github.com/bee-queue/bee-queue/compare/v1.2.3...v1.3.0) (2020-11-03)

### Features

- implement Queue#saveAll feature ([#198](https://github.com/bee-queue/bee-queue/issues/198)) ([851f09d](https://github.com/bee-queue/bee-queue/commit/851f09df65d144adc7d6798c91c8d665e52400d5))
- support custom strategies on a queue ([#134](https://github.com/bee-queue/bee-queue/issues/134)) ([926de9d](https://github.com/bee-queue/bee-queue/commit/926de9dc016541cdfdd6139b780ecf4058a6e709))
- **types:** add generics to type definitions ([a565d3d](https://github.com/bee-queue/bee-queue/commit/a565d3dc2acf120cb7a91cdfbbf2840d67267ae7))
- **types:** add isRunning ([c488385](https://github.com/bee-queue/bee-queue/commit/c4883859fbbdc0eb0ee894d77097c67e528e2d31))
- **types:** add ready handler ([32c4b1e](https://github.com/bee-queue/bee-queue/commit/32c4b1ef45e82a7bd5698445f30e7460ece71484))

### Bug Fixes

- **backoff:** allow no delay arg when setting immediate strategy ([#154](https://github.com/bee-queue/bee-queue/issues/154)) ([6f1d62f](https://github.com/bee-queue/bee-queue/commit/6f1d62fc493c5f2ad20eae5a8122fc316c092451))
- **queue:** remove error event listener on close ([#231](https://github.com/bee-queue/bee-queue/issues/231)) ([36b4904](https://github.com/bee-queue/bee-queue/commit/36b4904b363cae1a84bb38f1d8c40f3e7f930c44))
- **removeJob:** remove job from stored jobs ([#230](https://github.com/bee-queue/bee-queue/issues/230)) ([a8c9d87](https://github.com/bee-queue/bee-queue/commit/a8c9d87f106cf4e0f51b5a6b1000cc1e1e19e6ad))
- **types:** support progress events using arbitrary data ([#140](https://github.com/bee-queue/bee-queue/issues/140)) ([bc8aa52](https://github.com/bee-queue/bee-queue/commit/bc8aa522f66ed7038bdea03629c0f3244ea8a55f))
- **types:** update createJob handler for consistency ([b71a993](https://github.com/bee-queue/bee-queue/commit/b71a9930c1cbf3de3c191073b6c1c41e7bcde1d8))
- **types:** update redis option type ([#290](https://github.com/bee-queue/bee-queue/issues/290)) ([e80c51d](https://github.com/bee-queue/bee-queue/commit/e80c51db100f9a0e7fc596b27bcd9c8a5e78791f))
- **types:** update type declaration ([#252](https://github.com/bee-queue/bee-queue/issues/252)) ([1dce7ca](https://github.com/bee-queue/bee-queue/commit/1dce7ca9cc90da328d5943a3f77483849d3dd816))
- misc edge case fixes ([a2df983](https://github.com/bee-queue/bee-queue/commit/a2df9836dbeeef7458c09d6b7aa2f674e5d0efeb))
- update typescript declarations and add documentation ([#187](https://github.com/bee-queue/bee-queue/issues/187)) ([cec1498](https://github.com/bee-queue/bee-queue/commit/cec1498ecc486c26c6a0b882daf360ad8c0d0402)), closes [#138](https://github.com/bee-queue/bee-queue/issues/138)

## [1.3.0](https://github.com/bee-queue/bee-queue/compare/v1.2.3...v1.3.0) (2020-11-02)

### Features

- implement Queue#saveAll feature ([#198](https://github.com/bee-queue/bee-queue/issues/198)) ([851f09d](https://github.com/bee-queue/bee-queue/commit/851f09df65d144adc7d6798c91c8d665e52400d5))
- support custom strategies on a queue ([#134](https://github.com/bee-queue/bee-queue/issues/134)) ([926de9d](https://github.com/bee-queue/bee-queue/commit/926de9dc016541cdfdd6139b780ecf4058a6e709))
- **types:** add generics to type definitions ([a565d3d](https://github.com/bee-queue/bee-queue/commit/a565d3dc2acf120cb7a91cdfbbf2840d67267ae7))
- **types:** add isRunning ([c488385](https://github.com/bee-queue/bee-queue/commit/c4883859fbbdc0eb0ee894d77097c67e528e2d31))
- **types:** add ready handler ([32c4b1e](https://github.com/bee-queue/bee-queue/commit/32c4b1ef45e82a7bd5698445f30e7460ece71484))

### Bug Fixes

- **backoff:** allow no delay arg when setting immediate strategy ([#154](https://github.com/bee-queue/bee-queue/issues/154)) ([6f1d62f](https://github.com/bee-queue/bee-queue/commit/6f1d62fc493c5f2ad20eae5a8122fc316c092451))
- **queue:** remove error event listener on close ([#231](https://github.com/bee-queue/bee-queue/issues/231)) ([36b4904](https://github.com/bee-queue/bee-queue/commit/36b4904b363cae1a84bb38f1d8c40f3e7f930c44))
- **removeJob:** remove job from stored jobs ([#230](https://github.com/bee-queue/bee-queue/issues/230)) ([a8c9d87](https://github.com/bee-queue/bee-queue/commit/a8c9d87f106cf4e0f51b5a6b1000cc1e1e19e6ad))
- **types:** support progress events using arbitrary data ([#140](https://github.com/bee-queue/bee-queue/issues/140)) ([bc8aa52](https://github.com/bee-queue/bee-queue/commit/bc8aa522f66ed7038bdea03629c0f3244ea8a55f))
- **types:** update createJob handler for consistency ([b71a993](https://github.com/bee-queue/bee-queue/commit/b71a9930c1cbf3de3c191073b6c1c41e7bcde1d8))
- **types:** update redis option type ([#290](https://github.com/bee-queue/bee-queue/issues/290)) ([e80c51d](https://github.com/bee-queue/bee-queue/commit/e80c51db100f9a0e7fc596b27bcd9c8a5e78791f))
- **types:** update type declaration ([#252](https://github.com/bee-queue/bee-queue/issues/252)) ([1dce7ca](https://github.com/bee-queue/bee-queue/commit/1dce7ca9cc90da328d5943a3f77483849d3dd816))
- misc edge case fixes ([a2df983](https://github.com/bee-queue/bee-queue/commit/a2df9836dbeeef7458c09d6b7aa2f674e5d0efeb))
- update typescript declarations and add documentation ([#187](https://github.com/bee-queue/bee-queue/issues/187)) ([cec1498](https://github.com/bee-queue/bee-queue/commit/cec1498ecc486c26c6a0b882daf360ad8c0d0402)), closes [#138](https://github.com/bee-queue/bee-queue/issues/138)

# 1.2.3 / 2020-01-28

- Allow arbitrary values for progress (#109).
- Fix cleanup of event redis client (#178).
- Fix bluebird warning spam (#85).
- Update Typescript definition for `Queue#close` method (#180).
- Remove Node 4, 6 from CI (#156, 223151c).

# 1.2.2 / 2018-01-25

- Update Typescript type definitions (thanks @brickyang for #98).

# 1.2.1 / 2018-01-15

- Update Typescript type definitions (thanks @brickyang for #94).

# 1.2.0 / 2018-01-10

- Add Typescript type definitions (thanks @pbadenski for #80 and @martinwepner for #89).

# 1.1.0 / 2017-08-12

- Support sharing the redis command client between Queues.
- Add documentation, add tests for expected behavior.

# 1.0.0 / 2017-06-30

- Upgrade node-redis to 2.7.1
  Note that redis connection options now match the latest redis.
- Implement delayed jobs
- Implement fixed, exponential backoff strategies
- Add promise support
- Fix race conditions in tests
- Add new performance settings
- Emit stalled event for stalled jobs
- Implement graceful shutdown
- Support user-specified jobids (should be non-numeric)
- Add timeout, stacktraces to job options

# 0.3.0 / 2015-09-01

- Bump node-redis dependency to 1.0.0

# 0.2.0 / 2015-06-12

- Initial release

# 0.1.0 / 2015-01-26

- Early development
