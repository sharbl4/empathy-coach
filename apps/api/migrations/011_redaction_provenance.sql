-- Owner-bound HMAC fingerprints only, never original email/phone values.
ALTER TABLE app.product_sessions ADD COLUMN redactions jsonb NOT NULL DEFAULT '{}';
