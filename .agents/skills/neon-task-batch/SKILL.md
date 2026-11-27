---
name: neon-task-batch
description: Audit and complete NEON task-list batches across web, mobile, artwork, and fact-check repositories while preserving explicit external gates.
---

# NEON task batch completion

Use this skill when working from a NEON single-serving task list or a task-batch handoff.

1. Read the referenced task file and repository instructions. Inspect the current branch, dirty files, and PR before changing anything; keep unrelated user work intact.
2. Make a checklist from every named task and its stated done condition. Separate code that can be verified locally from account, device, production, asset-owner, GPU, and live-service gates.
3. Reuse existing NEON components, tokens, helpers, and canonical assets. Never redraw a logo, invent credentials, apply a production migration without explicit authorization, or claim a live check from source inspection alone.
4. For database or external-service work, use dry-run/read-only modes first. Keep owner data and credentials out of logs and committed files.
5. Add focused tests for non-trivial logic, then run the repository's requested tests, type checks, and relevant build or smoke checks. Record exact results and any limits.
6. Recheck each task against its done condition. Update task status and PR text to reflect verified completion and remaining gates; keep a PR draft while required external gates remain.
