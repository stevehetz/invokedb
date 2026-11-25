-- Run once on a new production database, right after the first migrations (deploy.sh init-db).
-- The migrations seed demo accounts whose password ("password") and API keys are in the public
-- repo. This gives each one a random password and revokes its API keys (#138: the keys are in
-- the api_key table), so nobody can sign in or call the API with them. Re-enable one later with
-- a password reset; it can then make new keys.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE account
SET password_hash = crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf', 12))
WHERE email IN (
    'demo@invokedb.com', 'demo2@invokedb.com', 'demo3@invokedb.com', 'demo4@invokedb.com',
    'demo5@invokedb.com', 'demo6@invokedb.com', 'demo7@invokedb.com',
    'seh264@gmail.com', 'shetzel84@gmail.com'
);

UPDATE api_key
SET revoked_datetime = current_timestamp
WHERE revoked_datetime IS NULL
  AND account_id IN (
    SELECT id FROM account
    WHERE email IN (
        'demo@invokedb.com', 'demo2@invokedb.com', 'demo3@invokedb.com', 'demo4@invokedb.com',
        'demo5@invokedb.com', 'demo6@invokedb.com', 'demo7@invokedb.com',
        'seh264@gmail.com', 'shetzel84@gmail.com'
    )
  );

DELETE FROM session;
