const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const norm = (s) => s.replace(/\s+/g, " ").trim();

test("every slot-advance copy matches NEXT_SLOT_SQL", async () => {
  const { NEXT_SLOT_SQL } = await import("../lib/cadence.ts");
  const want = norm(NEXT_SLOT_SQL);
  const files = { "lib/generate.ts": 3, "lib/limits.ts": 1, "app/api/cron/dispatch/route.ts": 1 };
  for (const [file, count] of Object.entries(files)) {
    const src = norm(readFileSync(file, "utf8"));
    assert.equal(src.split(want).length - 1, count, `${file} should hold ${count} exact copies`);
    assert.equal((src.match(/case cadence/g) || []).length, count, `${file} has a drifted case cadence`);
  }
});

test("firstSlot: daily picks today if still ahead, else tomorrow", async () => {
  const { firstSlot } = await import("../lib/cadence.ts");
  // 2026-11-25 is a Wednesday. Detroit is UTC-5 in November.
  const now = new Date("2026-11-25T13:00:00Z"); // 08:00 Detroit
  assert.equal(firstSlot("daily", "09:00", "America/Detroit", now).toISOString(), "2026-11-25T14:00:00.000Z");
  assert.equal(firstSlot("daily", "07:00", "America/Detroit", now).toISOString(), "2026-11-26T12:00:00.000Z");
  assert.equal(firstSlot("manual", "09:00", "America/Detroit", now), null);
  assert.equal(firstSlot("daily", "9am", "America/Detroit", now), null);
  assert.equal(firstSlot("daily", "09:00", "Mars/Base", now), null);
});

test("firstSlot: twice a day uses time and time + 12h", async () => {
  const { firstSlot } = await import("../lib/cadence.ts");
  const noonDetroit = new Date("2026-11-25T17:00:00Z");
  // 07:00 and 19:00: at noon the next is 19:00 today.
  assert.equal(firstSlot("twice_daily", "07:00", "America/Detroit", noonDetroit).toISOString(), "2026-11-26T00:00:00.000Z");
  // 19:00 entered: still pairs with 07:00, so at 08:00 the next is 19:00.
  const eight = new Date("2026-11-25T13:00:00Z");
  assert.equal(firstSlot("twice_daily", "19:00", "America/Detroit", eight).toISOString(), "2026-11-26T00:00:00.000Z");
  const six = new Date("2026-11-25T11:00:00Z");
  assert.equal(firstSlot("twice_daily", "19:00", "America/Detroit", six).toISOString(), "2026-11-25T12:00:00.000Z");
});

test("firstSlot: weekdays skip the weekend, twice a week is Mon & Thu", async () => {
  const { firstSlot } = await import("../lib/cadence.ts");
  const fridayEvening = new Date("2026-11-27T23:00:00Z"); // Fri 18:00 Detroit
  assert.equal(firstSlot("weekdays", "09:00", "America/Detroit", fridayEvening).toISOString(), "2026-11-30T14:00:00.000Z"); // Mon
  const wednesday = new Date("2026-11-25T13:00:00Z");
  assert.equal(firstSlot("twice_weekly", "09:00", "America/Detroit", wednesday).toISOString(), "2026-11-26T14:00:00.000Z"); // Thu
  const thursdayLate = new Date("2026-11-26T20:00:00Z");
  assert.equal(firstSlot("twice_weekly", "09:00", "America/Detroit", thursdayLate).toISOString(), "2026-11-30T14:00:00.000Z"); // Mon
});

test("firstSlot handles DST: wall-clock time stays put across the change", async () => {
  const { firstSlot } = await import("../lib/cadence.ts");
  // US DST starts 2027-03-14. Day before: 09:00 EST = 14:00Z; day of: 09:00 EDT = 13:00Z.
  assert.equal(firstSlot("daily", "09:00", "America/Detroit", new Date("2027-03-13T15:00:00Z")).toISOString(), "2027-03-14T13:00:00.000Z");
});

test("show.md accepts friendly cadence spellings", async () => {
  const { normalizeCadence, CADENCES } = await import("../lib/show-spec.ts");
  assert.equal(normalizeCadence("Twice a day"), "twice_daily");
  assert.equal(normalizeCadence("twice-weekly"), "twice_weekly");
  assert.equal(normalizeCadence("Weekdays"), "weekdays");
  const cadence = await import("../lib/cadence.ts");
  assert.deepEqual(CADENCES, cadence.CADENCES);
});

test("firstSlot: 'days' only lands on picked weekdays", async () => {
  const { firstSlot } = await import("../lib/cadence.ts");
  // Wed 2026-11-25 10:00 Detroit (15:00Z), show airs Tue + Sat at 08:00.
  const now = new Date("2026-11-25T15:00:00Z");
  const slot = firstSlot("days", "08:00", "America/Detroit", now, [2, 6]);
  assert.equal(slot.toISOString(), "2026-11-28T13:00:00.000Z"); // Saturday 08:00 Detroit
  assert.equal(firstSlot("days", "08:00", "America/Detroit", now, []), null);
});

test("show.md round-trips picked days", async () => {
  const s = await import("../lib/show-spec.ts");
  const spec = { ...s.emptyShowSpec(), title: "T", cadence: "days", days: [2, 6] };
  const back = s.parseShowMd(s.toShowMd(spec)).spec;
  assert.deepEqual(back.days, [2, 6]);
  assert.ok(s.validateShowSpec({ ...spec, days: [] }).some((e) => /at least one day/.test(e)));
});
