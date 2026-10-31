CREATE TABLE app.accounts (
  id uuid PRIMARY KEY REFERENCES app.profiles(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL UNIQUE CHECK(telegram_user_id>0),
  email text, email_verified_at timestamptz, consent_version text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.domain_intents (
  user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  operation text NOT NULL, resource text NOT NULL, intent_key uuid NOT NULL,
  payload_hmac text NOT NULL, result jsonb, error_code text,
  state text NOT NULL DEFAULT 'completed' CHECK(state IN ('processing','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,operation,resource,intent_key)
);
CREATE TABLE app.email_challenges (
  id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  email text NOT NULL, code_hmac text NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  state text NOT NULL CHECK(state IN ('sending','sent','failed','consumed','invalidated')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL
);
CREATE INDEX challenge_owner ON app.email_challenges(user_id,created_at DESC);
CREATE TABLE app.email_rate_events (
  user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,email_hmac text NOT NULL,created_at timestamptz NOT NULL
);
CREATE INDEX email_rate_owner ON app.email_rate_events(user_id,created_at DESC);
CREATE INDEX email_rate_address ON app.email_rate_events(email_hmac,created_at DESC);
CREATE TABLE app.dialogues (
  user_id uuid PRIMARY KEY REFERENCES app.accounts(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), stage text NOT NULL DEFAULT 'onboarding',draft jsonb NOT NULL DEFAULT '{}',
  session_id uuid,roleplay_id uuid,pending_run_id uuid,expires_at timestamptz NOT NULL,
  CHECK(octet_length(draft::text)<=24000)
);
CREATE TABLE app.telegram_inbox (
  bot_id bigint NOT NULL,update_id bigint NOT NULL CHECK(update_id>=0),user_id uuid REFERENCES app.accounts(id) ON DELETE SET NULL,
  intent_key uuid NOT NULL,principal_hmac text NOT NULL,status text NOT NULL CHECK(status IN ('processing','completed')),
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,PRIMARY KEY(bot_id,update_id)
);
CREATE INDEX inbox_pending ON app.telegram_inbox(bot_id,update_id) WHERE status='processing';
CREATE TABLE app.telegram_cursors(bot_id bigint PRIMARY KEY,next_offset bigint NOT NULL DEFAULT 0 CHECK(next_offset>=0));
CREATE TABLE app.run_deliveries (
  id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  run_id uuid NOT NULL UNIQUE REFERENCES app.ai_runs(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),ordinary_failures integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,claim_token uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_ready ON app.run_deliveries(next_attempt_at,created_at) WHERE state IN ('pending','claimed');
ALTER TABLE app.ai_runs DROP CONSTRAINT ai_runs_kind_check;
ALTER TABLE app.ai_runs ADD CONSTRAINT ai_runs_kind_check CHECK(kind IN ('analysis','reply_feedback','reply_examples','exercise','exercise_feedback','roleplay_start','roleplay_turn','roleplay_feedback','say_direct'));
CREATE TABLE app.run_jobs (
  run_id uuid PRIMARY KEY REFERENCES app.ai_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  state text NOT NULL CHECK(state IN ('queued','running','finished')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_live_job_per_user ON app.run_jobs(user_id) WHERE state IN ('queued','running');
CREATE INDEX jobs_queue ON app.run_jobs(created_at,run_id) WHERE state='queued';
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I',r);
    END IF;
  END LOOP;
END $$;
