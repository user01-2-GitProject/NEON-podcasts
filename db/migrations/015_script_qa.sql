-- B1 — Script QA notes from the cheap proofreading pass (jimmy, 2026-11-26).
-- Stored as { notes: [{ kind, message, excerpt? }], model, checked_at }.
-- Null on runs that predate the check or failed before a script existed.
alter table runs add column if not exists script_qa jsonb;
