-- A1 2.1 additive storage. Applied migrations 001-006 remain immutable.
ALTER TABLE app.email_challenges DROP CONSTRAINT email_challenges_state_check;
ALTER TABLE app.email_challenges ADD CHECK(state IN ('sending','sent','delivery_unknown','failed','consumed','invalidated'));
ALTER TABLE app.telegram_inbox DROP CONSTRAINT telegram_inbox_status_check;
ALTER TABLE app.telegram_inbox ADD CHECK(status IN ('processing','completed','retry_wait','failed'));
ALTER TABLE app.telegram_inbox ADD COLUMN attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3), ADD COLUMN next_attempt_at timestamptz, ADD COLUMN failure jsonb;
ALTER TABLE app.web_sessions ADD COLUMN last_seen_at timestamptz;
UPDATE app.web_sessions SET last_seen_at=created_at;
ALTER TABLE app.web_sessions ALTER COLUMN last_seen_at SET NOT NULL;
ALTER TABLE app.web_login_links ADD COLUMN issue_key uuid;
CREATE UNIQUE INDEX web_link_issue ON app.web_login_links(user_id,issue_key);
CREATE TABLE app.browser_bindings(id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE app.web_exchanges(binding_id uuid NOT NULL REFERENCES app.browser_bindings(id) ON DELETE CASCADE,intent_key uuid NOT NULL,payload_hmac text NOT NULL,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,session_id uuid NOT NULL REFERENCES app.web_sessions(id) ON DELETE CASCADE,link_id uuid NOT NULL REFERENCES app.web_login_links(id) ON DELETE CASCADE,PRIMARY KEY(binding_id,intent_key));
CREATE TABLE app.product_sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,input jsonb NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(id,user_id));
CREATE INDEX product_history ON app.product_sessions(user_id,updated_at DESC,id DESC);
-- Carry forward v1 domain situations without assigning pre-Telegram profiles to anyone.
INSERT INTO app.product_sessions(id,user_id,input,revision,created_at,updated_at)
 SELECT s.id,s.user_id,jsonb_build_object('mode','understand','title',s.title,'relationship',s.situation->>'relationship','context',COALESCE(s.situation->>'context',''),'contextType','close','goal',s.situation->>'goal','message',s.situation->>'message','guess',jsonb_build_object('emotions',COALESCE(s.guess->'emotions','[]'::jsonb),'quotes',COALESCE(s.guess->'evidenceQuotes','[]'::jsonb),'unsure',COALESCE(s.guess->'unsure','true'::jsonb))),s.revision,s.created_at,s.updated_at
 FROM app.sessions s JOIN app.accounts a ON a.id=s.user_id;
CREATE TABLE app.product_dialogues(user_id uuid PRIMARY KEY REFERENCES app.accounts(id) ON DELETE CASCADE,value jsonb NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE app.product_previews(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,session_id uuid,value jsonb NOT NULL,source jsonb NOT NULL,expires_at timestamptz,created_at timestamptz NOT NULL,UNIQUE(id,user_id),FOREIGN KEY(session_id,user_id) REFERENCES app.product_sessions(id,user_id) ON DELETE CASCADE);
CREATE TABLE app.product_roles(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,session_id uuid NOT NULL,session_revision integer NOT NULL,value jsonb NOT NULL,last_run_id uuid,UNIQUE(id,user_id),FOREIGN KEY(session_id,user_id) REFERENCES app.product_sessions(id,user_id) ON DELETE CASCADE);
CREATE UNIQUE INDEX product_active_role ON app.product_roles(session_id,session_revision) WHERE value->>'status'='active';
CREATE TABLE app.product_runs(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,session_id uuid,preview_id uuid NOT NULL,value jsonb NOT NULL,snapshot jsonb NOT NULL,roleplay_id uuid,created_at timestamptz NOT NULL,UNIQUE(id,user_id),FOREIGN KEY(session_id,user_id) REFERENCES app.product_sessions(id,user_id) ON DELETE CASCADE,FOREIGN KEY(preview_id,user_id) REFERENCES app.product_previews(id,user_id) ON DELETE CASCADE,FOREIGN KEY(roleplay_id,user_id) REFERENCES app.product_roles(id,user_id) ON DELETE CASCADE);
CREATE UNIQUE INDEX product_one_pending_user ON app.product_runs(user_id) WHERE value->>'status'='pending';
CREATE INDEX product_queue ON app.product_runs(created_at,id) WHERE value->>'phase'='queued';
CREATE TABLE app.product_deliveries(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,run_id uuid UNIQUE,payload jsonb,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','completed','failed')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),ordinary_failures integer NOT NULL DEFAULT 0,claim_token uuid,lease_until timestamptz,next_attempt_at timestamptz NOT NULL,created_at timestamptz NOT NULL,FOREIGN KEY(run_id,user_id) REFERENCES app.product_runs(id,user_id) ON DELETE CASCADE);
CREATE INDEX product_delivery_ready ON app.product_deliveries(next_attempt_at,created_at) WHERE state IN ('pending','claimed');
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I',r); END IF; END LOOP; END $$;
