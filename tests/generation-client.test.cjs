const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readJson, pollRun } = require('../components/generation-client.ts');

test('rejects non-JSON and unsuccessful responses with a friendly message', async () => {
  await assert.rejects(readJson(new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'text/html' } }), 'test'), /Generation didn't finish/);
});

test('polls until done and failed terminal states', async () => {
  const makeFetcher = (states) => async () => new Response(JSON.stringify(states.shift()), { headers: { 'content-type': 'application/json' } });
  const noWait = async () => {};
  assert.equal((await pollRun('a', makeFetcher([{ status: 'running' }, { status: 'done' }]), noWait)).status, 'done');
  assert.equal((await pollRun('b', makeFetcher([{ status: 'failed', error: 'bad' }]), noWait)).error, 'bad');
});
