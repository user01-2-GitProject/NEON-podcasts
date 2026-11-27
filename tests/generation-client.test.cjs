const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readJson, pollRun, pollEpisodeAudio } = require('../components/generation-client.ts');

test('rejects non-JSON and unsuccessful responses with a friendly message', async () => {
  await assert.rejects(readJson(new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'text/html' } }), 'test'), /Generation didn't finish/);
});

test('polls until done and failed terminal states', async () => {
  const makeFetcher = (states) => async () => new Response(JSON.stringify(states.shift()), { headers: { 'content-type': 'application/json' } });
  const noWait = async () => {};
  assert.equal((await pollRun('a', makeFetcher([{ status: 'running' }, { status: 'done' }]), noWait)).status, 'done');
  assert.equal((await pollRun('b', makeFetcher([{ status: 'failed', error: 'bad' }]), noWait)).error, 'bad');
});

test('polls episode audio until the incremental job is complete', async () => {
  const responses = [{ complete: false }, { complete: true }];
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(responses.shift()), {
      status: calls.length === 1 ? 202 : 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await pollEpisodeAudio('episode-1', 'run-1', fetcher, async () => {});
  assert.equal(result.complete, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/episodes/episode-1/audio');
  assert.deepEqual(JSON.parse(calls[0].options.body), { runId: 'run-1' });
});
