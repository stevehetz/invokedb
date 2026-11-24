# Security policy

InvokeDB runs at https://invokedb.com. If you find a security problem in the service or in this
repository, please report it privately so it can be fixed before it's public.

## How to report

- Preferred: GitHub's private vulnerability reporting, on this repository's **Security** tab,
  **Report a vulnerability**.
- Or email **support@invokedb.com** with "Security" in the subject.

Please include what you found, how to reproduce it, and what an attacker could do with it.
Don't access other people's data, degrade the service, or run automated scans against
production; a proof of concept against your own account is enough.

## What to expect

- A reply within a few days.
- A fix as soon as possible for anything serious, deployed from `main`.
- Credit in the fix's advisory if you'd like it.

## Supported versions

Only what's deployed at https://invokedb.com (the `main` branch) is supported. The `invokedb` npm
client in `examples/invokedb-node` is supported at its latest version.
