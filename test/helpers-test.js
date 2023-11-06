const {describe} = require('ava-spec');

const sinon = require('sinon');

const {delay, finallyRejectsWithInitial} = require('../lib/helpers');

const mark = () =>
  (
    (start) => () =>
      ((end) => (end[0] - start[0]) * 1e3 + (end[1] - start[1]) / 1e6)(
        process.hrtime()
      )
  )(process.hrtime());

describe('finallyRejectsWithInitial', (it) => {
  it('invokes the function', async (t) => {
    const spy = sinon.spy();
    await finallyRejectsWithInitial(Promise.resolve(), spy);
    t.true(spy.calledOnce);
    spy.resetHistory();

    await t.throwsAsync(
      () => finallyRejectsWithInitial(Promise.reject(new Error('test 1')), spy),
      {message: 'test 1'}
    );
    t.true(spy.calledOnce);
    spy.resetHistory();

    await finallyRejectsWithInitial(delay(11), spy);
    t.true(spy.calledOnce);
  });

  it('prefers the original error', async (t) => {
    const stub = sinon.stub().rejects(new Error('second'));

    await t.throwsAsync(
      () => finallyRejectsWithInitial(Promise.resolve(), stub),
      {message: 'second'}
    );
    t.true(stub.calledOnce);
    stub.resetHistory();

    await t.throwsAsync(
      () => finallyRejectsWithInitial(Promise.reject(new Error('first')), stub),
      {message: 'first'}
    );
    t.true(stub.calledOnce);
  });

  it('produces the original value', async (t) => {
    const stub = sinon.stub().returns('second');

    t.is(
      await finallyRejectsWithInitial(Promise.resolve('first'), stub),
      'first'
    );
  });

  it('handles synchronous exceptions', async (t) => {
    const stub = sinon.stub().throws(new Error('err 2'));

    await t.throwsAsync(
      () => finallyRejectsWithInitial(Promise.resolve(), stub),
      {message: 'err 2'}
    );
    t.true(stub.calledOnce);
    stub.resetHistory();

    const measure = mark();
    await t.throwsAsync(
      () =>
        finallyRejectsWithInitial(
          delay(11).then(() => Promise.reject(new Error('err 1'))),
          stub
        ),
      {message: 'err 1'}
    );
    t.true(measure() >= 10);
    t.true(stub.calledOnce);
    stub.resetHistory();
  });

  it('waits for the returned Promise', async (t) => {
    const stub = sinon.stub().returns(delay(11, 'twelve'));

    const measure = mark();
    t.is(
      await finallyRejectsWithInitial(Promise.resolve('eleven'), stub),
      'eleven'
    );
    t.true(measure() >= 10);
    t.true(stub.calledOnce);
  });
});
