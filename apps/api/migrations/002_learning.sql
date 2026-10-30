ALTER TABLE app.roleplays ADD COLUMN last_run_id uuid;
ALTER TABLE app.roleplays ADD CONSTRAINT roleplay_last_run_owner
  FOREIGN KEY(last_run_id,session_id,user_id) REFERENCES app.ai_runs(id,session_id,user_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX one_active_roleplay_per_revision ON app.roleplays(session_id,revision) WHERE status='active';
CREATE INDEX practice_owner_time ON app.practice_events(user_id,created_at DESC,id DESC);
