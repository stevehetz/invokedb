-- Run once on a new production database, right after the first migrations (deploy.sh init-db).
-- The migrations seed demo accounts whose password ("password") and API keys are in the public
-- repo. This gives each one a random password and API key, so nobody can sign in or call the API
-- with them. Re-enable one later with a password reset.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE account
SET password_hash = crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf', 12)),
    api_key = encode(gen_random_bytes(16), 'hex')
WHERE email IN (
    'demo@invokedb.com', 'demo2@invokedb.com', 'demo3@invokedb.com', 'demo4@invokedb.com',
    'demo5@invokedb.com', 'demo6@invokedb.com', 'demo7@invokedb.com',
    'seh264@gmail.com', 'shetzel84@gmail.com'
);

DELETE FROM session;
