# Fact-check council — task status

2026-11-27 · Implementation status for [`2026-11-27-fact-check-council.md`](2026-11-27-fact-check-council.md)
and Jimmy's original task table. All work is on branch `claude/fact-check-council`; the working tree is clean.

## Completed

- [x] **F1 — migration.** `db/migrations/016_fact_check.sql` adds `runs.fact_check jsonb`,
  `shows.fact_check_council boolean not null default false`, and mirrors both in `db/schema.sql`.
  Commit `aa004ef` (refined in `7824ce0`). Applying it to production still needs Jimmy's OK (see below).
- [x] **F2 — wire layer 1 into `generateEpisode`.** `runFactCheck()` runs immediately after
  `runScriptQa()`; all five `script_qa` writes also write `fact_check`; opted-in shows stay draft.
  `Run.fact_check` and `Show.fact_check_council` are typed. Commits `aa004ef`, `7824ce0`.
- [x] **F3 — owner UI.** `components/EpisodesPanel.tsx` shows automatic notes, council verdict,
  grade, tags, per-persona flags, dismissals, added sources and "Awaiting council". The show page
  selects `fact_check`. Commit `85ab50e`.
- [x] **F4 — layer-1 tests.** `tests/fact-check.test.cjs` covers prompt building, parsing, quorum
  aggregation and mocked `runFactCheck` paths. Commits `861ebd9`, `c856590`.
- [x] **F5 — POST endpoint.** `app/api/episodes/[id]/fact-check/route.ts` resolves the caller,
  checks show ownership, validates the submission and returns `{ ok, fact_check, published }`.
  Commit `90ac172`.
- [x] **F5b — unanimous merge.** `lib/fact-check.ts` exports `noteKey`, `councilVerdict`,
  `validateCouncilSubmission`, `mergeCouncilResult` and the council types. The server recomputes
  the verdict, so a forged `pass` is rejected. Commit `90ac172`.
- [x] **F5c — pending endpoint.** `app/api/council/pending/route.ts` plus injectable helpers in
  `lib/council.ts` return the ten oldest opted-in episodes with server-built prompts for all
  three personas. Commit `90ac172`.
- [x] **F7 — council leader.** `scripts/fact-check-council.mjs` is dependency-free Node 20+;
  it fans out to Codex/Muse, runs the Lead and rebuttal rounds, assembles the submission, and
  POSTs it. `--once`, graceful shutdown, no token logging. `tests/fact-check-council-script.test.cjs`
  passes 9/9. Commits `4a4e619`, `2b1a5df`.
- [x] **F8 — docs.** `docs/fact-check-agents.md` follows the `live-agents.md` style and documents
  opt-in, the Rig invocation, env vars, the Muse drop-folder contract, prompt/JSON shapes, both
  endpoints and the grading table. Commits `aa5b70f`, `2b1a5df`.
- [x] **F9 — fallback buttons.** Owner-only "Copy Quickdraw prompt" / "Copy Scholar prompt"
  buttons copy server-built prompts; briefing text is stripped before client props. Commit `85ab50e`.
- [x] **F10 — grading/tagging.** `gradeScript()` produces A–F bands, tags, error types and
  `caught_by` counts; tags include topic, format, error types and the persona that caught an issue.
  Owners can override a stored grade with a reason. Automatic and overridden scores are both kept.
- [x] **Q1 — FEVER/LIAR prep.** The fetcher writes trainer-normalized records and the requested
  `instruction/context/output` files, with separate sample/full caches. Full fetch completed:
  FEVER has 145,449 train + 19,998 labelled dev rows; LIAR has 12,836 train/valid/test rows. The
  official FEVER total of 185,445 also includes an unlabelled blind test split, so only labelled
  train/dev rows are emitted. Full data outputs stay local and ignored; committed samples remain
  available for offline tests.
- [x] **Q2 — synthetic claims.** 2,520 deterministic labelled podcast claims in
  `fact-check-training/data/synthetic/podcast_claims.jsonl`, 420 per topic, with exact 40/30/20/10
  label distribution and Q1's `instruction/context/output` schema.
- [x] **Q3 — training env.** `train.py` (QLoRA), `eval.py`/`evaluate.py`, `export.py` (adapter merge
  plus llama.cpp GGUF conversion), pinned `requirements.txt` and README. CLI help and compilation
  verified; actual GPU training is Q4.
- [x] **Q5 — Qwen voter.** The leader accepts `QWEN_URL`/`QWEN_MODEL`, calls Ollama `/api/chat`,
  includes Qwen as an optional fourth member, and can ask it to accept/reject a dismissal. The
  server accepts a `qwen` member and builds `prompts.qwen`. Smoke-tested against local Ollama.
  Commits `2b1a5df`, `90ac172`.

## Blocked — needs Jimmy or a GPU box

- [ ] **Q4 — run training + evaluate.** The pipeline is ready, but this machine has no NVIDIA/AMD
  compute GPU (`nvidia-smi` absent, no ROCm), `torch` is not installed, and no cloud GPU credentials
  are set (`HF_TOKEN`, `MODAL_TOKEN_ID`, `RUNPOD_API_KEY`, `LAMBDA_API_KEY`, `REPLICATE_API_TOKEN`
  all unset). No fine-tuned adapter or >85% FEVER-dev result can be produced here. Run the commands
  in `fact-check-training/README.md` on a CUDA box, then copy the adapter into Ollama as
  `qwen3.5-9b-fc` for the Q5 voter.
- [ ] **F1 prod apply.** Migration 016 is written but intentionally not applied to production;
  Jimmy must approve/apply it.
- [ ] **F7 trusted-source list and Rig run.** Active show briefing documents and the run's exact
  briefing snapshot are both included in checker prompts. A vetted trusted-source list is not
  present in the repo, so none was invented; the list and a credentialed Rig run remain pending.

## Verification evidence

```text
$ npm test
ℹ tests 388
ℹ pass 388
ℹ fail 0

$ npx tsc --noEmit
TYPECHECK_OK

$ timeout 30 node --import tsx --test tests/fact-check-council-script.test.cjs
ℹ tests 9
ℹ pass 9
ℹ fail 0

$ python3 -m py_compile fact-check-training/{fetch_data,train,evaluate,generate_synthetic}.py
(no output — all compile)

$ python3 (independent synthetic-data check)
lines=3500 unique_ids=3500 json_parse=OK labels_ok=True schema_ok=True

$ python3 -m unittest discover -s fact-check-training -p 'test_*.py'
Ran 2 tests — OK
```

Live Q5 smoke test used the already-installed `qwen2.5-coder:7b` Ollama model; the leader's
`runQwen()` returned a parsed `{persona, model, notes, added_sources}` result from `/api/chat`.
This verifies the plumbing, not the fine-tuned model's accuracy — that remains Q4.
