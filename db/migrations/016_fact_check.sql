-- Fact-check notes from verifying a script against its source material.
-- Stored as { notes: [{ kind, message, excerpt? }], model, checked_at }.
-- Null on runs that predate the check, have no briefing, or failed before a script existed.
alter table runs add column if not exists fact_check jsonb;
