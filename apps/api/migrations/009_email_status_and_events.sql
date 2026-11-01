ALTER TABLE app.email_challenges ADD COLUMN masked_email text;
UPDATE app.email_challenges SET masked_email=left(split_part(email,'@',1),2)||'***@'||split_part(email,'@',2) WHERE email LIKE '%@%';
-- Anonymous resource-free funnel events describe one account transition, not clicks.
DELETE FROM app.product_events a USING app.product_events b WHERE a.user_id=b.user_id AND a.name=b.name AND a.resource_id IS NULL AND b.resource_id IS NULL AND a.id>b.id;
CREATE UNIQUE INDEX product_event_account ON app.product_events(user_id,name) WHERE resource_id IS NULL;
