'use strict';

const EagerTimer = require('../lib/eager-timer');

const expect = require('chai').expect;
const sinon = require('sinon');

describe('EagerTimer', function () {
  beforeEach(function () {
    this.clock = sinon.useFakeTimers();
    this.timer = new EagerTimer(500);

    this.triggered = sinon.spy();
    this.timer.on('trigger', this.triggered);
  });

  afterEach(function () {
    this.timer.stop();
    this.clock.restore();
  });

  it('should trigger in the future', function () {
    this.timer.schedule(200);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(199);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(2);
    expect(this.triggered.calledOnce).to.be.true;
  });

  it('should not trigger after the maximum delay', function () {
    this.timer.schedule(600);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(499);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(2);
    expect(this.triggered.calledOnce).to.be.true;
  });

  it('should trigger again', function () {
    this.timer.schedule(5);
    this.clock.tick(6);
    expect(this.triggered.calledOnce).to.be.ok;
    this.clock.tick(500);
    expect(this.triggered.calledTwice).to.be.ok;
  });

  it('should overwrite a later timer', function () {
    this.timer.schedule(300);
    this.timer.schedule(200);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(201);
    expect(this.triggered.calledOnce).to.be.ok;
    this.clock.tick(100);
    expect(this.triggered.calledOnce).to.be.ok;
  });

  it('should overwrite a later timer after a delay', function () {
    this.timer.schedule(300);
    this.clock.tick(5);
    this.timer.schedule(200);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(196);
    expect(this.triggered.calledOnce).to.be.ok;
    this.clock.tick(100);
    expect(this.triggered.calledOnce).to.be.ok;
    this.clock.tick(401);
    expect(this.triggered.calledTwice).to.be.ok;
  });

  it('should not overwrite an earlier timer', function () {
    this.timer.schedule(20);
    this.timer.schedule(300);
    this.clock.tick(19);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(2);
    expect(this.triggered.calledOnce).to.be.ok;
  });

  it('should not overwrite an earlier timer with the maximum delay', function () {
    this.timer.schedule(20);
    this.timer.schedule(1000);
    this.clock.tick(19);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(2);
    expect(this.triggered.calledOnce).to.be.ok;
  });

  it('should trigger after the maximum delay for negative times', function () {
    this.timer.schedule(-1);
    this.clock.tick(499);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(2);
    expect(this.triggered.calledOnce).to.be.ok;
  });

  it('should trigger after the maximum delay on null', function () {
    this.timer.schedule(null);
    this.clock.tick(499);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(2);
    expect(this.triggered.calledOnce).to.be.ok;
  });

  it('should trigger after the maximum delay on undefined', function () {
    this.timer.schedule(undefined);
    this.clock.tick(499);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(2);
    expect(this.triggered.calledOnce).to.be.ok;
  });

  it('should trigger after the maximum delay on NaN', function () {
    this.timer.schedule(NaN);
    this.clock.tick(499);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(2);
    expect(this.triggered.calledOnce).to.be.ok;
  });

  it('should not overwrite an earlier timer on null', function () {
    this.timer.schedule(20);
    this.timer.schedule(null);
    this.clock.tick(19);
    expect(this.triggered.called).to.be.false;
    this.clock.tick(2);
    expect(this.triggered.calledOnce).to.be.ok;
  });

  it('should trigger immediately for passed times', function () {
    this.clock.tick(10);
    expect(this.triggered.called).to.be.false;
    this.timer.schedule(5);
    expect(this.triggered.calledOnce).to.be.ok;
    this.clock.tick(10);
    expect(this.triggered.calledOnce).to.be.ok;
  });

  it('should not trigger after stopping', function () {
    this.timer.schedule(50);
    this.clock.tick(25);
    this.timer.stop();
    this.clock.tick(50);
    expect(this.triggered.called).to.be.false;
  });

  it('should not schedule after stopping', function () {
    this.timer.schedule(50);
    this.clock.tick(25);
    this.timer.stop();
    this.timer.schedule(25);
    this.clock.tick(50);
    expect(this.triggered.called).to.be.false;
  });

  it('should fail on invalid maximum delays', function () {
    expect(() => new EagerTimer(-1)).to.throw(/positive integer/i);
    expect(() => new EagerTimer(NaN)).to.throw(/positive integer/i);
    expect(() => new EagerTimer(Infinity)).to.throw(/positive integer/i);
    expect(() => new EagerTimer(1.5)).to.throw(/positive integer/i);
  });
});
