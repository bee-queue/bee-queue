import {describe} from 'ava-spec';
import sandbox from 'sandboxed-module';
import lolex from 'lolex';
import sinon from 'sinon';

function maybeCoverage() {
  return Object.keys(require.cache).some((path) =>
    path.includes('node_modules/nyc')
  );
}

describe('EagerTimer', (it) => {
  it.beforeEach(async (t) => {
    // Some reasonable time so we don't start at 0.
    const start = 10;
    const clock = lolex.createClock(start);

    const EagerTimer = sandbox.require('../lib/eager-timer', {
      locals: {
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        Date: clock.Date,
      },
      // Voodoo magic to support nyc.
      sourceTransformers: maybeCoverage()
        ? {
            nyc(source) {
              const Instrumenter = require('nyc/lib/instrumenters/istanbul');
              const instrumenter = Instrumenter(process.cwd(), {});
              const instrumentMethod = instrumenter.instrumentSync.bind(
                instrumenter
              );
              return instrumentMethod(source, this.filename, {
                registerMap() {},
              });
            },
          }
        : {},
    });

    const timer = new EagerTimer(500);
    const trigger = sinon.spy();
    timer.on('trigger', trigger);

    Object.assign(t.context, {EagerTimer, timer, clock, start, trigger});
  });

  it('should trigger in the future', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 200);
    t.false(trigger.called);
    t.is(clock.next(), start + 200);
    t.true(trigger.calledOnce);
  });

  it('should not trigger after the maximum delay', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 600);
    t.false(trigger.called);
    t.is(clock.next(), start + 500);
    t.true(trigger.calledOnce);
  });

  it('should trigger again', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 600);
    t.is(clock.next(), start + 500);
    t.true(trigger.calledOnce);
    t.is(clock.next(), start + 1000);
    t.true(trigger.calledTwice);
  });

  it('should overwrite a later timer', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 300);
    timer.schedule(start + 200);
    t.is(clock.next(), start + 200);
    t.true(trigger.calledOnce);
    t.not(clock.next(), start + 500);
  });

  it('should overwrite a later timer after a delay', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 300);
    clock.tick(5);
    timer.schedule(start + 200);
    t.false(trigger.called);
    t.is(clock.next(), start + 200);
    t.true(trigger.calledOnce);
    t.is(clock.next(), start + 700);
  });

  it('should not overwrite an earlier timer', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 20);
    timer.schedule(start + 300);
    t.is(clock.next(), start + 20);
    t.true(trigger.calledOnce);
    t.not(clock.next(), start + 300);
  });

  it('should not overwrite an earlier timer with the maximum delay', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 20);
    timer.schedule(start + 1000);
    t.is(clock.next(), start + 20);
    t.true(trigger.calledOnce);
    t.not(clock.next(), start + 1000);
  });

  it('should trigger after the maximum delay for negative times', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(-1);
    t.is(clock.next(), start + 500);
    t.true(trigger.calledOnce);
  });

  it('should trigger after the maximum delay on null', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(null);
    t.is(clock.next(), start + 500);
    t.true(trigger.calledOnce);
  });

  it('should trigger after the maximum delay on undefined', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(undefined);
    t.is(clock.next(), start + 500);
    t.true(trigger.calledOnce);
  });

  it('should trigger after the maximum delay on NaN', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(NaN);
    t.is(clock.next(), start + 500);
    t.true(trigger.calledOnce);
  });

  it('should not overwrite an earlier timer on null', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 20);
    timer.schedule(null);
    t.false(trigger.called);
    t.is(clock.next(), start + 20);
    t.true(trigger.calledOnce);
  });

  it('should trigger immediately for passed timestamps', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start - 5);
    t.true(trigger.calledOnce);
    t.is(clock.next(), start + 500);
  });

  it('should not trigger after stopping', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 50);
    clock.tick(25);
    timer.stop();
    t.is(clock.next(), clock.now);
    t.false(trigger.called);
  });

  it('should not schedule immediately after stopping', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 50);
    clock.tick(25);
    timer.stop();
    timer.schedule(start + 25);
    t.is(clock.next(), clock.now);
    t.false(trigger.called);
  });

  it('should not schedule later after stopping', (t) => {
    const {clock, timer, start, trigger} = t.context;

    timer.schedule(start + 50);
    clock.tick(25);
    timer.stop();
    timer.schedule(start + 50);
    t.is(clock.next(), clock.now);
    t.false(trigger.called);
  });

  it('should fail on invalid maximum delays', (t) => {
    const {EagerTimer} = t.context;

    t.throws(() => new EagerTimer(-1), /positive integer/i);
    t.throws(() => new EagerTimer(NaN), /positive integer/i);
    t.throws(() => new EagerTimer(Infinity), /positive integer/i);
    t.throws(() => new EagerTimer(1.5), /positive integer/i);
  });
});
