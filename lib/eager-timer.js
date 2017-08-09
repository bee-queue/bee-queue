'use strict';

const Emitter = require('events').EventEmitter;

/**
 * A timer that will eagerly replace an existing timer with a sooner one.
 * Refuses to set a later timer, or a timer beyond the given maximum delay.
 */
class EagerTimer extends Emitter {
  constructor(maxDelay) {
    super();

    if (!Number.isSafeInteger(maxDelay) || maxDelay <= 0) {
      throw new Error('maximum delay must be a positive integer');
    }

    this._maxDelay = maxDelay;
    this._nextTime = null;
    this._timer = null;

    this._stopped = false;
    this._boundTrigger = this._trigger.bind(this);
  }

  schedule(time) {
    if (this._stopped) return;

    const now = Date.now();

    if (time < 0 || time == null || isNaN(time)) {
      // Times earlier than 0 signify maximum delay.
      time = now + this._maxDelay;
    } else if (time <= now) {
      // If it's in the past, trigger immediately, and reschedule to max delay.
      this._schedule(now + this._maxDelay);
      return this.emit('trigger');
    } else {
      // Don't try to schedule past the maximum delay.
      time = Math.min(time, now + this._maxDelay);
    }

    // Only overwrite the existing timer if later than the given time.
    if (!this._timer || time < this._nextTime) {
      this._schedule(time);
    }
  }

  stop() {
    this._stop();
    this._stopped = true;
  }

  // PRIVATE METHODS

  _stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._nextTime = null;
      this._timer = null;
    }
  }

  _schedule(time) {
    const duration = time - Date.now();

    this._stop();
    this._nextTime = time;
    this._timer = setTimeout(this._boundTrigger, duration);
  }

  _trigger() {
    const now = Date.now(), remaining = this._nextTime - now;
    /* istanbul ignore if */
    if (remaining > 0) {
      // It's possible (it caused tests to fail) to have the timeout trigger
      // before the scheduled time.
      this._timer = setTimeout(this._boundTrigger, remaining);
      return;
    }
    this._schedule(now + this._maxDelay);
    this.emit('trigger');
  }
}

module.exports = EagerTimer;
