-- Persist upload preview plans and revert snapshots so they survive server restarts.
ALTER TABLE manual_uploads ADD COLUMN preview_plan_json TEXT;
ALTER TABLE manual_uploads ADD COLUMN revert_snapshot_json TEXT;
