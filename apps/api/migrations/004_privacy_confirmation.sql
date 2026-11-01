CREATE TABLE app.ai_confirmations (
  user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),kind text NOT NULL,
  context_hmac text NOT NULL,expires_at timestamptz NOT NULL,
  FOREIGN KEY(session_id,user_id) REFERENCES app.sessions(id,user_id) ON DELETE CASCADE,
  PRIMARY KEY(user_id,session_id,revision,kind)
);
REVOKE ALL ON app.ai_confirmations FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON app.ai_confirmations FROM %I',r);END IF;
  END LOOP;
END $$;
