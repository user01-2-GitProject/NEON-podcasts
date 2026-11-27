# Fact-check council — implementation plan

Status and evidence: [`2026-11-27-fact-check-council-status.md`](2026-11-27-fact-check-council-status.md).

2026-11-27 · Claude (plan keeper). Source: Jimmy's "Fact-check council plan" (pasted 2026-11-27), corrected
after a repo review. Branch `claude/fact-check-council`, stacked on PR #112 (`lib/fact-check.ts` + migration 016).

## Spec (the binding requirements, from Jimmy's plan)

- Two layers. Layer 1 = free OpenRouter models, automatic, inside `generateEpisode`, every episode.
  Layer 2 = council (Quickdraw = Codex, Scholar = Muse, Lead = Claude) run from the Rig, only for opted-in shows.
- Both layers write `runs.fact_check` (jsonb). Layer 1 writes `{ notes, model, checked_at }`. The council adds
  `agent_notes`, `verdict`, `grade` (+ `council`, `added_sources`).
- **Unanimous rule:** all members clean → `pass`. A flag the Lead agrees with → `fail`. A flag the Lead calls a
  false positive needs an explanation; if the original flagger still disagrees after reading it → `fail`.
- Fail → the episode stays a draft; the owner sees which persona flagged what.
- Every checker gets the same **locked source list**: the show's active briefings as stored in
  `runs.briefing_snapshot` (+ future vetted list). Members may add sources; additions are recorded in
  `added_sources[]` and only influence the verdict if the Lead accepts them.
- Grade after every council run: A pass with 0 flags; B pass after false-positive dismissal; C fail with 1–2 minor;
  D fail with a major; F fail with multiple majors. Tags + error types + `caught_by` counts per persona.
- Persona prompt prefixes are verbatim from the source plan (copied into Task 3).

## Global Constraints

- Repo conventions: Next.js 16 app router, `@/lib/db` `sql` tagged template, tests are `tests/*.test.cjs` run by
  `npm test` (`node --import tsx --test`), they `import("../lib/x.ts")` and often regex-read source files. NOT `lib/__tests__`.
- `npm test` and `npx tsc --noEmit` must both stay green. Baseline at branch start: 322/322 pass, tsc clean.
- No new npm dependencies. `scripts/fact-check-council.mjs` is dependency-free Node 20+.
- No local Postgres: never run SQL against prod (`.env.local`). Migration files are written, never applied.
- Bearer auth is enforced in middleware (`bearerRequestAllowed`): mutations need a `read_write` token from an
  approved owner. Route handlers resolve the caller with `currentCaller()` from `lib/current-user.ts` and must check
  `shows.user_id = caller.userId` for the episode's show.
- Fact-check note kinds stay `FACT_CHECK_KINDS` = `wrong | unsupported | outdated | missing-context`.
- Severity: `wrong` and `outdated` are **major**; `unsupported` and `missing-context` are **minor**.
- Persona keys are exactly `quickdraw`, `scholar`, `lead` (future `qwen`).

## Rulings on the source plan (made before execution)

1. Codex flags in the source (`--prompt`, `--output-json`) don't exist → use `codex exec --output-schema <file> -o <file> <prompt>`.
2. "Pending = fewer than 2 agent_notes" never clears a clean script → pending = opted-in show, run has a script,
   and `fact_check->'council'->>'verdict'` is null.
3. Verdict authority lives in ONE place: the leader script decides; the server validates the submission, recomputes
   the verdict from the submitted member results with the same unanimous rule (rejects a mismatch), grades, stores.
4. The rebuttal round is part of F7 (flagger re-asked with the Lead's reason).
5. Publish gate: new `shows.fact_check_council boolean default false` (in migration 016). For those shows an auto
   episode is rendered but kept `draft` until a `pass` arrives; the POST then publishes it. Owner override = the
   existing manual publish (PATCH `/api/episodes/:id` status). No timeout.
6. Prompts are built server-side (TS) and returned by `GET /api/council/pending`, so the dependency-free leader
   script and the F9 buttons share one prompt builder.
7. Out of scope this run: F1 prod apply (needs Jimmy), Q1–Q5 (dataset download + GPU training), vetted-sources list.

---

## Task 1: F4 — tests for the existing fact-check module

Files: create `tests/fact-check.test.cjs`. Do not change `lib/fact-check.ts` unless a test exposes a real bug
(report it if so).

Cover, following `tests/script-qa.test.cjs` style:
- `buildFactCheckPrompt(script, briefing)` returns `{system, user}`; system names all four kinds; user contains both
  the script and the briefing, each truncated to 10,000 chars.
- `parseFactCheckNotes`: parses `{"notes":[...]}` inside surrounding prose/code fences; drops unknown kinds and
  empty messages; trims message to 240 and excerpt to 160; returns `[]` on garbage.
- `aggregateNotes`: a note flagged by 2 of 3 lists is kept with `agreed: 2`; flagged by 1 is dropped at
  minAgreement 2; duplicates inside one list count once; max 8 notes; sorted by agreement desc.
- `runFactCheck` with `config: { openRouterApiKey: "k" }` and a mocked `fetchImpl`:
  empty briefing → `{notes:[], model:null}` without calling fetch; no key → same; 3 free models answer → aggregated
  notes and `model` lists all three; only 1 free model answers → one call to `openai/gpt-4o-mini`; all fail → empty.

## Task 2: F1 + F2 — migration + wire layer 1 into generateEpisode + publish gate

Files: `db/migrations/016_fact_check.sql`, `db/schema.sql`, `lib/generate.ts`, `lib/types.ts`,
`tests/fact-check-generate.test.cjs` (new).

- Migration 016 also adds `alter table shows add column if not exists fact_check_council boolean not null default false;`
  with a comment. Mirror both columns (`runs.fact_check jsonb`, `shows.fact_check_council`) in `db/schema.sql`.
- `lib/types.ts`: `Run.fact_check: FactCheck | null`; `Show.fact_check_council: boolean`. Extend the `FactCheck`
  interface in `lib/fact-check.ts` with optional council fields typed as `unknown`-free placeholders ONLY if Task 3
  needs them — leave it to Task 3 (this task only imports `FactCheck`).
- In `generateEpisode`, right after `runScriptQa(...)`: `const factCheck = await runFactCheck({ script: result.script, briefingSnapshot });`
  and `const fcJson = JSON.stringify(factCheck);`. Every `update runs set ...` that writes `script_qa = ${qaJson}`
  (5 places today) also writes `fact_check = ${fcJson}`.
- Publish gate: in the two auto-mode paths that set `status = 'published', published_at = now()`, when
  `show.fact_check_council` is true keep `status = 'draft'` (audio_url still saved, published_at null).
  External mode is unchanged (already draft).
- Test (regex over `lib/generate.ts`, the repo's existing pattern for generate): runFactCheck is imported and called
  after runScriptQa; the count of `fact_check = ${fcJson}` equals the count of `script_qa = ${qaJson}`; the publish
  statements are conditional on `fact_check_council`. Plus migration/schema text checks.

## Task 3: F5b + F10 — council verdict, merge and grading (pure lib)

Files: `lib/fact-check.ts`, `tests/fact-check-council.test.cjs` (new).

Add exports (pure, no DB):

```ts
export const COUNCIL_PERSONAS = ["quickdraw", "scholar", "lead"] as const;
export type CouncilPersona = (typeof COUNCIL_PERSONAS)[number];
export const PERSONA_PREFIX: Record<"quickdraw" | "scholar", string>; // verbatim text below
export interface CouncilFlag extends FactCheckNote { persona: CouncilPersona; }
export interface CouncilDismissal { flag: CouncilFlag; reason: string; flagger_agrees: boolean; }
export interface CouncilMemberResult { persona: CouncilPersona; model: string; notes: FactCheckNote[]; }
export interface CouncilSubmission {
  members: CouncilMemberResult[];        // quickdraw + scholar required, lead optional (its own flags)
  upheld: CouncilFlag[];                 // flags the Lead agrees are real
  dismissed: CouncilDismissal[];         // flags the Lead called false positives
  verdict: "pass" | "fail";
  tags?: string[];                       // topic/format tags, max 8, each <= 32 chars, lowercased
  added_sources?: { url: string; by: CouncilPersona; accepted: boolean }[];
}
export interface ScriptGrade {
  score: "A" | "B" | "C" | "D" | "F";
  tags: string[]; error_types: FactCheckKind[];
  caught_by: Record<string, number>;     // persona -> upheld+unresolved flags; plus "free_models" = layer-1 notes count
  notes: string;                         // one plain sentence
}
export interface CouncilRecord { verdict: "pass" | "fail"; voted: CouncilPersona[]; decided_at: string; }
// FactCheck gains optional: agent_notes?: CouncilFlag[]; verdict?: "pass"|"fail"; grade?: ScriptGrade;
//                           council?: CouncilRecord; added_sources?: CouncilSubmission["added_sources"]; dismissed?: CouncilDismissal[]
export function buildCouncilPrompt(persona: "quickdraw" | "scholar", script: string, briefingSnapshot: string): { system: string; user: string };
export function validateCouncilSubmission(body: unknown): { ok: true; value: CouncilSubmission } | { ok: false; error: string };
export function councilVerdict(s: Pick<CouncilSubmission, "upheld" | "dismissed">): "pass" | "fail";
export function gradeScript(s: CouncilSubmission, layer1: FactCheckNote[]): ScriptGrade;
export function mergeCouncilResult(existing: FactCheck | null, s: CouncilSubmission, now?: Date): FactCheck;
```

Rules:
- `buildCouncilPrompt` = `buildFactCheckPrompt` with `PERSONA_PREFIX[persona] + "\n\n"` prepended to `system`.
- `councilVerdict`: `fail` if any `upheld`, or any `dismissed` with `flagger_agrees === false`; else `pass`.
- `validateCouncilSubmission`: object; `members` includes both `quickdraw` and `scholar`; every note/flag kind in
  `FACT_CHECK_KINDS`, message non-empty string (trim to 240, excerpt to 160); `dismissed[].reason` non-empty;
  `verdict` must equal `councilVerdict(...)` else error `"verdict does not follow the unanimous rule"`;
  every upheld/dismissed flag's persona is one of the members; tags/added_sources shape-checked.
- `gradeScript`: majors = unresolved flags (upheld + dismissed-with-flagger-disagreeing) whose kind is
  `wrong|outdated`. pass & no dismissals → A; pass with ≥1 dismissal → B; fail & 0 majors & ≤2 unresolved → C;
  fail & 0 majors & >2 unresolved → D; fail & exactly 1 major → D; fail & ≥2 majors → F.
  `error_types` = distinct kinds of unresolved flags. `caught_by[persona]` = unresolved flags by that persona
  (0 for members with none); `caught_by.free_models` = `layer1.length`. `notes` e.g.
  `"Fail: Scholar flagged 1 wrong fact."` / `"Pass: no flags."` / `"Pass: 1 flag dismissed as a false positive."`
- `mergeCouncilResult`: keeps layer-1 `notes/model/checked_at` from `existing` (or empty defaults when null);
  `agent_notes` = unresolved flags, deduped by the existing `noteKey()`; sets `verdict`, `grade`
  (`gradeScript(s, existing?.notes ?? [])`), `dismissed`, `added_sources`,
  `council = { verdict, voted: members' personas, decided_at: now.toISOString() }`. Re-submitting replaces the
  previous council fields (it does not append across runs).

Persona prefixes (verbatim):

Quickdraw:
> You are the Quickdraw. You care about speed and accuracy above all else. Scan the script against the source material efficiently. Flag only concrete, clear-cut factual errors — wrong names, wrong numbers, wrong dates, wrong outcomes, claims that directly contradict the sources. Don't overthink edge cases or philosophical questions about framing. If the source says X and the script says Y, flag it. If the script adds a claim the sources don't mention at all, flag it as unsupported. Be fast, be precise, don't waste words.

Scholar:
> You are the Scholar. You are a strict skeptic and deeply studious. Read every line of the script methodically against every part of the source material. Check dates, names, numbers, context, and implications. Cross-reference claims against multiple sources where possible. Flag not only outright errors but also claims that are technically true but misleading because important context was omitted. Flag outdated information even if it was once correct. Take your time. Thoroughness matters more than speed. If you're unsure about a claim, flag it and explain your doubt.

Tests: every grade branch A–F, verdict rule incl. flagger-agrees dismissal → pass, validation rejects (missing
scholar, bad kind, empty reason, verdict mismatch, flag from a non-member), merge keeps layer-1 notes and dedups.

## Task 4: F5 + F5c — council API routes

Files: `app/api/episodes/[id]/fact-check/route.ts`, `app/api/council/pending/route.ts`, `lib/council.ts` (DB
helpers the routes call, `sql` injected for testability), `tests/council-routes.test.cjs` (new).

- `GET /api/council/pending` (any authenticated caller via `currentCaller`; 401 otherwise). Returns
  `{ items: [{ episode_id, run_id, show_id, title, script, briefing_snapshot, prompts: { quickdraw, scholar } }] }`
  for episodes whose show has `fact_check_council = true` and `user_id = caller.userId`, whose latest run has
  `episode_id` set, a non-empty script, and `fact_check->'council'->>'verdict'` null. Oldest first, limit 10.
  `prompts.*` = `buildCouncilPrompt(...)` objects.
- `POST /api/episodes/:id/fact-check` (401 no caller; 404 unknown episode or show not owned by caller; 400 with
  `{ error }` from `validateCouncilSubmission`). Loads the episode's latest run (by `created_at desc`) `fact_check`,
  writes `mergeCouncilResult(...)` back to that run. If verdict `pass` and the show has `fact_check_council` and the
  episode is `draft` with a non-null `audio_url`, sets `status = 'published', published_at = now()`. Returns
  `{ ok: true, fact_check, published: boolean }`.
- Tests: helper functions in `lib/council.ts` with a fake `sql` (records queries, returns canned rows): ownership
  404, validation 400 passthrough, pass-publishes-only-when-draft-with-audio, fail-never-publishes, pending filter
  SQL mentions `fact_check_council` and the council verdict null check. Plus route files call `currentCaller`.

## Task 5: F3 — fact-check notes, verdict and grade in the UI

Files: `components/EpisodesPanel.tsx`, `app/shows/[id]/page.tsx`, test `tests/fact-check-ui.test.cjs` (new, regex
style like `tests/episode-splice-ui.test.cjs`).

- Page query also selects `fact_check` (alongside `script_qa`), owner-only exactly like QA notes today.
- `FactCheckNotes` component next to `QaNotes`, same expandable pattern, amber/warning tokens from
  `app/globals.css` (use existing CSS variables — no hard-coded hex). Shows: layer-1 notes with "N of 3 models agreed";
  if `council`: verdict badge (Pass / Fail), grade letter + tags, council flags labelled by persona
  (Quickdraw / Scholar / Lead) and dismissed flags with the Lead's reason; "Awaiting council" when the show opted in
  and no verdict yet. Plain words, no jargon ("MoA").

## Task 6: F7 — council leader script

Files: `scripts/fact-check-council.mjs`, `tests/fact-check-council-script.test.cjs` (new).

Dependency-free Node 20+. Exports pure helpers + `main()`; runs `main()` only when executed directly.
- Env: `NEON_BASE_URL`, `NEON_TOKEN` (required); `CODEX_CMD` (default `codex`), `LEAD_CMD` (default `claude`),
  `MUSE_INPUT_DIR`, `MUSE_OUTPUT_DIR` (both required for the Scholar), `MUSE_TIMEOUT_MS` (default 1800000),
  `POLL_INTERVAL_MS` (default 120000), `ONCE=1` (one pass then exit).
- Loop: `GET /api/council/pending` → for each item, in parallel: Quickdraw via
  `$CODEX_CMD exec --skip-git-repo-check --output-schema <schema.json> -o <out.json> <prompt>` (prompt = system +
  "\n\n" + user, schema = `{notes:[{kind,message,excerpt}]}`), Scholar via writing
  `$MUSE_INPUT_DIR/fact-check-<episode_id>.md` and waiting for `$MUSE_OUTPUT_DIR/fact-check-<episode_id>.json`.
  Use `child_process.execFile` (no shell), temp files under `os.tmpdir()`.
- Lead: run `$LEAD_CMD -p --output-format json <prompt>` with both members' notes, asking for
  `{upheld:[flag], dismissed:[{flag, reason}], tags:[...]}`. For each dismissal, re-ask the flagging member (same
  channel) with the Lead's reason → `{agrees: boolean}`; set `flagger_agrees`.
- Build the `CouncilSubmission` (verdict via the same unanimous rule, reimplemented in JS and tested to match), POST
  it. A member that errors or times out → skip the episode this pass (no POST), log it. SIGINT/SIGTERM → finish the
  current item, exit 0. Logs one line per event to stdout; never logs the token.
- Tests: pure helpers (parse member JSON, `councilVerdict` parity table with Task 3, build submission, command arg
  arrays) with fake exec/fetch.

## Task 7: F8 — council docs

File: `docs/fact-check-agents.md`, style of `docs/live-agents.md`: what the two layers do, opting a show in,
running the leader on the Rig (env vars, `ONCE=1`), Muse drop-folder contract, prompt shape, JSON shapes, both
endpoints' contracts, grading table, owner override (publish manually). Plain English up top.

## Task 8: F9 — manual "Fact-check with…" buttons

Files: `components/EpisodesPanel.tsx` (+ page passes the prompts or the data to build them), test in
`tests/fact-check-ui.test.cjs`.

Owner-only buttons on the episode card: "Copy Quickdraw prompt" / "Copy Scholar prompt" — copy
`buildCouncilPrompt(persona, script, briefing_snapshot)` (system + blank line + user) to the clipboard, with a
"Copied" confirmation. Built server-side in the page and passed as props (keeps briefing text out of client
bundles' logic). Only when the episode has a run with a briefing snapshot.
