-- Existing active_config_profile_uuid remains the Xray assignment.
-- Both additions are nullable/defaulted, so existing nodes continue unchanged.
ALTER TABLE "config_profiles"
ADD COLUMN "core_type" TEXT NOT NULL DEFAULT 'xray';

ALTER TABLE "nodes"
ADD COLUMN "active_singbox_config_profile_uuid" UUID;

ALTER TABLE "nodes"
ADD CONSTRAINT "nodes_active_singbox_config_profile_uuid_fkey"
FOREIGN KEY ("active_singbox_config_profile_uuid")
REFERENCES "config_profiles"("uuid")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "nodes_active_singbox_config_profile_uuid_idx"
ON "nodes"("active_singbox_config_profile_uuid");
