CREATE TABLE app.user_update_slots (
  bot_id bigint NOT NULL,user_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  update_id bigint NOT NULL,process_id uuid NOT NULL,
  PRIMARY KEY(bot_id,user_id)
);
REVOKE ALL ON app.user_update_slots FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON app.user_update_slots FROM %I',r);END IF;
  END LOOP;
END $$;
