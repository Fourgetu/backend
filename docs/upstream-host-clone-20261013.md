# Host cloning adaptation — 2026-10-13

Adapted from upstream backend commit `ac57dd84`, without changing dependency versions or the database schema. Deliver with the companion frontend Host clone change.

`POST /api/hosts/actions/clone` accepts `{ "cloneFromUuid": "<uuid>" }` and returns the existing Host response with HTTP 201. It inherits authentication and role guards and declares the `hosts:clone` write scope. The fork uses error code `A272` for clone failures because upstream's `A258` already identifies its speed-limit error.

The service reads the source, shifts following positions, inserts a disabled Host with a new UUID, copies node and internal-squad links, and synchronizes the position sequence in one transaction. Host entity fields, including custom JSON settings and profile bindings, are retained. Independently owned user-route records and allocations are not duplicated. Missing hosts and detached profile bindings are rejected.

A short `SHARE ROW EXCLUSIVE` lock on `hosts` is acquired before reading the source position. It serializes clones and blocks overlapping table writes while positions and associations are changed. A relation failure rolls back inserted rows, links and position updates. PostgreSQL sequence increments are not transactional; gaps in generated positions remain possible and are harmless. A bulk request remains a series of independent clones, not a transaction across all selected hosts.

## Validation

101 existing unit tests and 6 PostgreSQL integration tests passed. Integration cases cover Xray and sing-box fields and relations, response schema, rollback after an injected relation failure, three simultaneous clones, missing/detached sources, and the custom error-code allocation. Rspack production build, Node contract check and changed-file lint passed. Local Node.js is 24.15.0, below the declared >=24.18.0; supported-runtime/container and HTTP/VPS smoke checks remain release-stage work.

## Reproducing the database test

Start a disposable PostgreSQL 17 database with database/user `clone_test`, bound to `127.0.0.1` on a free port. Apply this repository's Prisma schema with `prisma db push --skip-generate` using that disposable database's `DATABASE_URL`. Set `HOST_CLONE_TEST_DATABASE_URL` to its connection URL and run `npm run test:integration:host-clone`. The test checks the local hostname, database and user before connecting, creates fixtures and disconnects afterward. Destroy the disposable database when finished; never point this test or `db push` at a live Panel database.
