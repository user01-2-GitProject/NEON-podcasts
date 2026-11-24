const { test } = require("node:test");
const assert = require("node:assert/strict");

function fakeSql(rows = []) {
  const calls = [];
  const fn = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return rows;
  };
  fn.calls = calls;
  return fn;
}

test("DatabaseStorage.delete removes audio for the episode key", async () => {
  const { DatabaseStorage } = await import("../lib/storage.ts");
  const db = fakeSql();
  await new DatabaseStorage(db).delete("episode-123");

  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /delete from episode_audio/);
  assert.deepEqual(db.calls[0].values, ["episode-123"]);
});

test("S3Storage.delete sends a DeleteObjectCommand for the bucket and key", async () => {
  process.env.S3_ENDPOINT = "https://s3.example.test";
  process.env.S3_BUCKET = "audio-bucket";
  process.env.S3_ACCESS_KEY_ID = "test-access";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";

  const { S3Storage } = await import("../lib/storage.ts");
  const commands = [];
  const client = { send: async (command) => commands.push(command) };
  await new S3Storage(client).delete("episode-456");

  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].input, { Bucket: "audio-bucket", Key: "episode-456" });
});
