import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperienceConnector } from '../src/connect-experience.ts';
const expired = { code: 'UNAUTHORIZED' };
function setup(overrides = {}) {
  const calls = { session: 0, state: 0, settings: 0 };
  const read = Object.fromEntries(Object.keys(calls).map(key => [key, async () => { calls[key]++; return key; }]));
  return { calls, connect: createExperienceConnector({ ...read, unauthorized: e => e === expired, ...overrides }) };
}
test('startup waits for session and shares simultaneous connection attempts', async () => {
  let ready = false;
  const { calls, connect } = setup({ session: async () => { await Promise.resolve(); ready = true; return 'session'; }, state: async () => { assert.ok(ready); return 'state'; } });
  const a = connect(), b = connect(); assert.equal(a, b);
  assert.deepEqual(await a, { session: 'session', state: 'state', settings: 'settings' });
  assert.equal(calls.settings, 1);
});
test('expired startup session is reopened once before loading state', async () => {
  let states = 0;
  const { calls, connect } = setup({ state: async () => { if (++states === 1) throw expired; return 'reconnected'; } });
  assert.equal((await connect()).state, 'reconnected'); assert.equal(calls.session, 2); assert.equal(states, 2);
});
test('blocked cookies stop after two attempts and manual reconnect remains possible', async () => {
  const { calls, connect } = setup({ state: async () => { throw expired; } });
  await assert.rejects(connect(), e => e === expired); assert.equal(calls.session, 2);
  await assert.rejects(connect(), e => e === expired); assert.equal(calls.session, 4);
});
test('network, limits and server errors are not retried; settings failure can degrade', async () => {
  for (const error of [{code:'NETWORK_UNAVAILABLE'},{code:'PREVIEW_SESSION_LIMIT'},{code:'INTERNAL'}]) {
    const { calls, connect } = setup({ state: async () => { throw error; } });
    await assert.rejects(connect(), e => e === error); assert.equal(calls.session, 1);
  }
  const { connect } = setup({ settings: async () => { throw new Error('unavailable'); } });
  assert.equal((await connect()).settings, null);
});
test('unauthorized settings cannot silently complete startup', async () => {
  const { calls, connect } = setup({ settings: async () => { throw expired; } });
  await assert.rejects(connect(), e => e === expired); assert.equal(calls.session, 2);
});
