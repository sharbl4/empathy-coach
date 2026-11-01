CREATE TABLE app.product_support_regions(user_id uuid PRIMARY KEY REFERENCES app.accounts(id) ON DELETE CASCADE,value jsonb NOT NULL);
-- No proof of the version shown by a v2.1 client: reset transient state only.
UPDATE app.product_dialogues SET value=jsonb_build_object(
 'revision',COALESCE((value->>'revision')::integer,0)+1,'step','menu','draft','{}'::jsonb,'navigation',jsonb_build_object('kind','none'),
 'sessionId',NULL,'previewId',NULL,'roleplayId',NULL,'pendingRunId',NULL,
 'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'expiresAt',to_char((clock_timestamp()+interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
 expires_at=clock_timestamp()+interval '1 hour' WHERE NOT(value ? 'navigation' AND value ? 'createdAt');
UPDATE app.domain_intents SET result=NULL,state='failed',error_code='REVISION_CONFLICT' WHERE operation IN ('v2.updateDialogue','v2.resetDialogue') AND result IS NOT NULL;
REVOKE ALL ON app.product_support_regions FROM PUBLIC;
DO $$ DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON app.product_support_regions FROM %I',r);END IF;END LOOP;END $$;
