ALTER TABLE "users"
    ADD COLUMN "socks_username" TEXT,
    ADD COLUMN "socks_password" TEXT;

UPDATE "users"
SET
    "socks_username" = "id"::text,
    "socks_password" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

ALTER TABLE "users"
    ALTER COLUMN "socks_username" SET NOT NULL,
    ALTER COLUMN "socks_username" SET DEFAULT ('rw-' || replace(gen_random_uuid()::text, '-', '')),
    ALTER COLUMN "socks_password" SET NOT NULL,
    ALTER COLUMN "socks_password" SET DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

CREATE UNIQUE INDEX "users_socks_username_key" ON "users"("socks_username");
