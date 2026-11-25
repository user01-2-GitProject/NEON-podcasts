# NEON show spec — canonical `show.md`

> **Goal (jimmy, 2026-11-24):** one standard `show.md` we use uniformly so generation returns consistent, *tested* results — and the same fields power a form for users who don't write markdown (e.g. Matt).

The idea: **one schema, two front doors.** A `show.md` file and a web form both produce the *same* structured `ShowSpec` object. That object drives the DB row and the generation prompt, so md-writers and form-users converge on identical input, and we can snapshot-test the prompt.

```
show.md ──┐
          ├──► parse ──► ShowSpec ──► shows row + style_guide + briefing ──► generation prompt
  form ───┘                                                     ▲
                                            golden/snapshot tests assert this is stable
```

---

## 1. `show.md` structure

**YAML frontmatter = the structured fields. Body = the editorial brief.** Frontmatter maps 1:1 to `shows` columns (+ a few new ones); the body becomes the show's `style_guide` and the recurring segment structure. This mirrors jimmy's `Episode-Template.md` but at the *show* level (the show template defines the recurring shape; each episode fills it in).

### Frontmatter fields

| Field | Type | DB / use | Required | Notes |
|---|---|---|---|---|
| `title` | string | `shows.title` | ✅ | Show name. |
| `tagline` | string | `shows.description` | — | One line; also RSS `<description>`. |
| `category` | string | RSS `<itunes:category>` | ✅ for publish | Valid Apple category. |
| `language` | string (BCP-47) | RSS `<language>` | — | Default `en-us`. |
| `explicit` | bool | RSS `<itunes:explicit>` | — | Default `false`. |
| `image_url` | url | `shows.image_url` (PR #46) | ✅ for publish | Artwork; itunes:image. |
| `cadence` | enum `daily\|weekly\|manual` | `shows.cadence` | ✅ | Scheduling. |
| `schedule_time` / `timezone` | `HH:MM` / IANA tz | `shows.schedule_time`/`timezone` | — | When the scheduler runs. |
| `target_minutes` | int | `shows.target_minutes` | ✅ | Episode length target. |
| `narration_mode` | enum `auto\|external` | `shows.narration_mode` | ✅ | `auto` = app renders TTS; `external` = script only. |
| `hosts` | list of `{name, voice}` | `shows.voice_id` (+ future multi-voice) | ✅ | Host name + the voice used. (Episode-Template's Host/Voice pairs.) |
| `pronunciations` | list of `{term, say_as, match}` | `show_pronunciations` | — | Lexicon applied before TTS. |
| `tags` | list of string | metadata | — | From the Episode-Template tag block. |

### Body sections

```
## Voice & style            → shows.style_guide (injected into every prompt)
Tone, pacing, do/don't, recurring bits (e.g. the "NEON PLUG" open/close).

## Segments                 → recurring structure each episode follows
### Segment 1 — <name> (<host>)
What it covers, the who/what/when/where/why/how frame, the questions to answer.
(…Segment 2, 3 — matches Episode-Template's segment layout.)

## Sources & guardrails     → part of style_guide / briefing
Where facts come from, what to avoid, accuracy rules.
```

Longer reference material still rides in `show_briefings` (`.md` uploads) as today; `show.md` is the show's *config + editorial spine*, not every source doc.

---

## 2. One parser, two front doors

- **`lib/show-spec.ts`** — `parseShowMd(text): { spec: ShowSpec, errors: string[] }` and `toShowMd(spec): string`. Pure, no DB.
- **`applyShowSpec(db, showId, spec)`** — writes the `shows` row + `style_guide` + replaces `show_pronunciations`. The generate route already reads those.
- **Form** — edits a `ShowSpec` directly (same type), with a "Download as `show.md`" / "Import `show.md`" button. Matt uses the form; power users keep their markdown; both yield the same `ShowSpec`.

Validation lives in one place (`validateShowSpec(spec): string[]`) so the file path and the form path reject the same bad input.

---

## 3. "Tested results" = snapshot the prompt, not the LLM

Deterministic and CI-safe: given a canonical `show.md`, assert the **assembled generation prompt** (what we send Claude/TTS — system prompt + style_guide + pronunciation directives + segment scaffold) is stable and contains the expected steering. A change to the template, parser, or prompt builder then can't silently drift a show's voice.

- `tests/show-spec.test.cjs`: `parseShowMd` ↔ `toShowMd` round-trips; `validateShowSpec` catches missing required / bad enums.
- `tests/show-prompt.snapshot.test.cjs`: `buildPrompt(spec)` matches a checked-in golden string for the example show.

---

## 4. Rollout

1. ✅ Lock this spec (frontmatter field list + body sections) — this doc (#49).
2. ✅ `lib/show-spec.ts` parser/serializer + validation + round-trip tests (#50).
3. ✅ Create from spec: `POST /api/shows/spec` (#53). Edit from spec: `GET`/`PUT /api/shows/[id]/spec` (export show.md / replace from show.md). Prompt golden test in `tests/show-spec.test.cjs`.
4. ✅ Form backed by `ShowSpec` (+ import/export `show.md`) — covers non-md users like Matt (#53). Show page has Download / Update from show.md.
5. Episodes: each episode fills the show's segment scaffold (jimmy's `Episode-Template.md` standardized — see `templates/episode.example.md`).

See `templates/show.example.md` for a filled example and `templates/episode.example.md` for the per-episode template (derived from `Episode-Template.md`).

---

## 5. Episode plans (`episode.md`)

An episode plan is a briefing doc with episode frontmatter (`title`, `episode`, `status`, `air_date`, `hosts`, `notes`; see `templates/episode.example.md`, from jimmy's `Episode-Template.md`). Upload it with the show's briefings like any other `.md`.

At generation time (`lib/episode-spec.ts`, `selectBriefings`):

- **Status:** `🟢 Ready` (or no status) is usable; `🟡 Not Ready` and `🔴 Completed - DO NOT USE` are held back.
- **Air date:** `MM-DD-YYYY` or `YYYY-MM-DD`. A plan isn't used before its air date (in the show's timezone). The `MM-DD-YYYY` placeholder counts as undated.
- **One plan per episode:** the ready plan with the earliest due air date wins (undated ones after dated ones). Other plans wait for a later run.
- The chosen plan's body (frontmatter stripped, with episode number, hosts and notes on top) goes to the writer alongside the regular briefings, and **its title is used as the episode title**.
- After a successful run the plan is switched off (made inactive) so it isn't reused. A failed run leaves it on for the retry.
