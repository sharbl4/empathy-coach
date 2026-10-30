CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I',r);
    END IF;
  END LOOP;
END $$;
CREATE TABLE app.profiles (
  id uuid PRIMARY KEY, display_name text NOT NULL DEFAULT 'Пользователь' CHECK (length(display_name) BETWEEN 1 AND 100),
  onboarding_completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app.profiles(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200), situation jsonb NOT NULL, guess jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,user_id)
);
CREATE INDEX sessions_history ON app.sessions(user_id,updated_at DESC,id DESC);
CREATE TABLE app.ai_runs (
  id uuid PRIMARY KEY, session_id uuid NOT NULL, user_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  kind text NOT NULL CHECK(kind IN ('analysis','reply_feedback','reply_examples','exercise','exercise_feedback','roleplay_start','roleplay_turn','roleplay_feedback')),
  status text NOT NULL CHECK(status IN ('pending','succeeded','failed')),
  input jsonb NOT NULL, output jsonb, prompt_version text NOT NULL, error_code text,
  idempotency_key uuid NOT NULL, payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(session_id,user_id) REFERENCES app.sessions(id,user_id) ON DELETE CASCADE,
  UNIQUE(user_id,idempotency_key), UNIQUE(id,session_id,user_id),
  CHECK ((status='pending' AND output IS NULL AND error_code IS NULL) OR
    (status='succeeded' AND output IS NOT NULL AND error_code IS NULL) OR
    (status='failed' AND output IS NULL AND error_code IS NOT NULL AND error_code IN ('RUN_INTERRUPTED','MODEL_TIMEOUT','MODEL_UNAVAILABLE','MODEL_INVALID_OUTPUT','MODEL_REFUSED','CONFIGURATION_ERROR')))
);
CREATE INDEX runs_revision ON app.ai_runs(session_id,revision,kind);
CREATE UNIQUE INDEX one_pending_per_session ON app.ai_runs(session_id) WHERE status='pending';
CREATE TABLE app.roleplays (
  id uuid PRIMARY KEY, session_id uuid NOT NULL, user_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
  status text NOT NULL CHECK(status IN ('active','completed')), turn_count integer NOT NULL DEFAULT 0 CHECK(turn_count BETWEEN 0 AND 3),
  feedback jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(session_id,user_id) REFERENCES app.sessions(id,user_id) ON DELETE CASCADE,
  UNIQUE(id,session_id,user_id)
);
CREATE TABLE app.roleplay_messages (
  id uuid PRIMARY KEY, roleplay_id uuid NOT NULL REFERENCES app.roleplays(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK(sequence>=0), role text NOT NULL CHECK(role IN ('user','assistant')),
  content text NOT NULL CHECK(length(content) BETWEEN 1 AND 3000), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(roleplay_id,sequence)
);
CREATE TABLE app.practice_events (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, session_id uuid NOT NULL,
  source_run_id uuid, source_roleplay_id uuid, kind text NOT NULL CHECK(kind IN ('analysis','exercise','roleplay')),
  skill text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(session_id,user_id) REFERENCES app.sessions(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(source_run_id,session_id,user_id) REFERENCES app.ai_runs(id,session_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(source_roleplay_id,session_id,user_id) REFERENCES app.roleplays(id,session_id,user_id) ON DELETE CASCADE,
  CHECK(num_nonnulls(source_run_id,source_roleplay_id)=1),
  UNIQUE(source_run_id), UNIQUE(source_roleplay_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I',r);
    END IF;
  END LOOP;
END $$;
