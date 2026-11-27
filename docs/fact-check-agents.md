# Fact-checking with the council

NEON checks a finished script twice. The **automatic check** runs inside episode generation for every show: three free OpenRouter models look for factual problems and the app stores their notes in the run's `fact_check` field. It costs nothing and never blocks an episode.

The **council** is a second, opt-in layer for shows whose owner wants a stricter gate. Three checkers read the same locked source list — the briefing snapshot the script was actually written from, plus any vetted sources added later:

- **Quickdraw** (Codex) — fast, concrete errors only.
- **Scholar** (Muse) — slow and methodical; flags errors and misleading context.
- **Lead** (Claude) — reads both reports, decides which flags are real, and posts the final result.

All three must agree before a script passes. If a checker flags something and the Lead agrees, the script fails. If the Lead thinks the flag is a false positive, the Lead writes a reason and the original checker is asked again; if that checker still disagrees, the script still fails. A failed episode stays a draft, and the owner can see who flagged what.

See [`plans/2026-11-27-fact-check-council.md`](plans/2026-11-27-fact-check-council.md) for the full build plan and [`live-agents.md`](live-agents.md) for the agent-token model. The council leader uses the same `npt_...` token, with `read_write` scope, as the Live join kit.

## 1. Opt a show in

The council only picks up shows with `shows.fact_check_council = true`. Migration 016 adds that column (default `false`) alongside `runs.fact_check`. Until there is an owner toggle in the UI, an owner can opt in with their normal database access:

```sql
update shows set fact_check_council = true where id = '<show uuid>';
```

Nothing is applied to production by the migration files — Jimmy applies migrations. For an opted-in show, auto-generated episodes still get audio, but stay `draft` until the council posts a `pass`. The POST publishes them automatically. There is no timeout: if the council never runs, the episode stays a draft. The owner can always publish manually from the episode list, which is the override.

## 2. Run the leader on the Rig

The leader is a dependency-free Node 20+ script. It polls for work, fans each episode out to Codex and Muse in parallel, runs the Lead and rebuttal rounds, then posts the result.

```bash
NEON_BASE_URL=https://neon.example \
NEON_TOKEN=npt_... \
CODEX_CMD=codex \
LEAD_CMD=claude \
MUSE_INPUT_DIR=/path/to/muse/inbox \
MUSE_OUTPUT_DIR=/path/to/muse/outbox \
node scripts/fact-check-council.mjs [--once]
```

`--once` (or `ONCE=1`) does one pass and exits — useful for a cron job or a manual test. Otherwise the script polls every `POLL_INTERVAL_MS` until Ctrl-C. SIGINT/SIGTERM finish the current episode before exiting. Every event is one line on stdout; the token is never logged.

| Variable | Required | Default | Meaning |
|----------|----------|---------|---------|
| `NEON_BASE_URL` | yes | — | App origin, e.g. `https://neon-podcasts.vercel.app`. |
| `NEON_TOKEN` | yes | — | An `agent:` token with `read_write` scope, from Settings → Devices. |
| `CODEX_CMD` | no | `codex` | Executable used for Quickdraw and rebuttals. |
| `LEAD_CMD` | no | `claude` | Executable used for the Lead round. |
| `MUSE_INPUT_DIR` | yes | — | Folder where the leader writes Muse prompt files. |
| `MUSE_OUTPUT_DIR` | yes | — | Folder where Muse writes result files. |
| `MUSE_TIMEOUT_MS` | no | `1800000` | How long to wait for Muse (30 minutes). |
| `POLL_INTERVAL_MS` | no | `120000` | Delay between polls (minimum 1000). |
| `ONCE` | no | `0` | Set to `1` for a single pass. |
| `QWEN_URL` | no | — | Ollama base URL for the optional Qwen voter, e.g. `http://127.0.0.1:11434`. |
| `QWEN_MODEL` | no | `qwen3.5-9b-fc` | Ollama model name used when `QWEN_URL` is set. |
| `QWEN_TIMEOUT_MS` | no | `60000` | Time allowed for a Qwen answer or rebuttal. |

### Quickdraw and Lead commands

The leader never builds a shell string. Quickdraw is invoked as:

```text
$CODEX_CMD exec --skip-git-repo-check --output-schema <schema.json> -o <out.json> <prompt>
```

The schema asks for `{ "notes": [{ "kind", "message", "excerpt" }], "added_sources": [...] }`. The Lead is invoked as:

```text
$LEAD_CMD -p --output-format json <prompt>
```

Its answer is parsed from either a plain JSON object or Claude's `{ "result": "..." }` envelope, including fenced JSON. If a member times out or errors, the leader logs the skip and does not POST a partial verdict.

### Muse drop-folder contract

For each episode the leader writes `MUSE_INPUT_DIR/fact-check-<episode_id>.md` — the full Scholar prompt, including the locked source list. Muse writes `MUSE_OUTPUT_DIR/fact-check-<episode_id>.json` with the same JSON shape as Quickdraw. The leader removes both files after reading the answer. For a rebuttal it uses the suffix `-rebuttal-<index>` and expects `{"agrees": true|false}`.

## 3. Prompt and JSON shapes

The server builds the prompts so the leader, the manual copy buttons and future voters all send the same text. `GET /api/council/pending` returns `prompts.quickdraw` and `prompts.scholar`, each `{ system, user }`. The leader joins them with a blank line. The system prompt is the normal fact-check instructions with the persona prefix prepended; the user prompt carries the script and the locked sources.

A member answer:

```json
{
  "notes": [{ "kind": "wrong", "message": "The script says Tuesday; the source says Monday.", "excerpt": "on Tuesday" }],
  "added_sources": ["https://example.com/original-report"]
}
```

Kinds are limited to `wrong`, `unsupported`, `outdated`, `missing-context`. Added sources are recorded but only influence the verdict if the Lead accepts them.

The Lead returns upheld flags, dismissals with reasons, tags, and accepted sources:

```json
{
  "upheld": [{ "persona": "scholar", "kind": "outdated", "message": "The figure changed in 2025." }],
  "dismissed": [{ "flag": { "persona": "quickdraw", "kind": "unsupported", "message": "..." }, "reason": "The briefing implies it." }],
  "tags": ["finance"],
  "accepted_sources": ["https://example.com/original-report"]
}
```

The leader then posts the assembled submission described below.

## 4. Endpoint contracts

| Endpoint | Auth | Response |
|----------|------|----------|
| `GET /api/council/pending` | Any signed-in caller or valid bearer token | `{ items: [{ episode_id, run_id, show_id, title, script, briefing_snapshot, prompts: { quickdraw, scholar } }] }` |
| `POST /api/episodes/:id/fact-check` | Caller must own the episode's show; writes need a `read_write` token | `{ ok: true, fact_check, published }` |

Pending items are the ten oldest episodes on opted-in shows owned by the caller whose latest run has a script and no council verdict yet. The POST validates the submission, recomputes the verdict from the unanimous rule (so a forged `verdict` cannot pass), stores `agent_notes`, `verdict`, `grade`, `council` and `added_sources` in `runs.fact_check`, and publishes a draft with audio only when the verdict is `pass`. An unknown episode or a show the caller does not own returns 404; an invalid submission returns 400 with an `error` message.

## 5. Grades

Every council run writes a grade to `runs.fact_check.grade`:

| Score | When |
|-------|------|
| A | Pass with no flags. |
| B | Pass after one or more flags were dismissed as false positives. |
| C | Fail with one or two minor flags and no majors. |
| D | Fail with one major flag, or more than two minor flags. |
| F | Fail with two or more major flags. |

`wrong` and `outdated` are major; `unsupported` and `missing-context` are minor. The grade also records topic/format tags, the kinds of error found, and `caught_by` counts for Quickdraw, Scholar, the free models and (later) Qwen. These grades are the training labels for the Qwen fact-check voter.

## 6. Manual fallback and Qwen

If the leader is not running, an owner can use **Copy Quickdraw prompt** / **Copy Scholar prompt** on an episode card. Those prompts are built server-side from the same locked source list; paste them into Codex or Muse and compare the answers yourself.

A fine-tuned Qwen3.5-9B can join as an optional fourth voter. Its training data and QLoRA setup live in `fact-check-training/`. Deploy it with Ollama on the Rig, then set `QWEN_URL` (and, if needed, `QWEN_MODEL`). The leader sends it the server-built `prompts.qwen`, includes its notes in the Lead's report, and can ask it to accept or reject a dismissal. The rule does not change: every voter must be clean for a pass. Without `QWEN_URL`, the council is the three-persona rule described above.
