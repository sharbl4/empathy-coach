CREATE TABLE app.web_login_links (
  id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz
);
CREATE INDEX web_link_owner_time ON app.web_login_links(user_id,created_at DESC);
CREATE TABLE app.web_sessions (
  id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz
);
CREATE INDEX web_session_owner ON app.web_sessions(user_id,expires_at);
REVOKE ALL ON app.web_login_links,app.web_sessions FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON app.web_login_links,app.web_sessions FROM %I',r);END IF;
  END LOOP;
END $$;
