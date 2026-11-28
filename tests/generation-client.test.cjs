const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readJson, pollRun, makeEpisodeAudio } = require('../components/generation-client.ts');

test('rejects non-JSON and unsuccessful responses with a friendly message', async () => {
  await assert.rejects(readJson(new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'text/html' } }), 'test'), /Generation didn't finish/);
});

test('polls until done and failed terminal states', async () => {
  const makeFetcher = (states) => async () => new Response(JSON.stringify(states.shift()), { headers: { 'content-type': 'application/json' } });
  const noWait = async () => {};
  assert.equal((await pollRun('a', makeFetcher([{ status: 'running' }, { status: 'done' }]), noWait)).status, 'done');
  assert.equal((await pollRun('b', makeFetcher([{ status: 'failed', error: 'bad' }]), noWait)).error, 'bad');
});

test('keeps requesting audio chunks until the endpoint reports complete', async () => {
  const requests = [];
  const responses = [false, true];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ complete: responses.shift() }), { headers: { 'content-type': 'application/json' } });
  };

  await makeEpisodeAudio('episode-1', 'run-1', fetcher, async () => {});

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url, '/api/episodes/episode-1/audio');
    assert.equal(request.options.method, 'POST');
    assert.deepEqual(JSON.parse(request.options.body), { runId: 'run-1' });
  }
});
