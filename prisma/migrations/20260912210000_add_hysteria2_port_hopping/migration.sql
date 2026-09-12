CREATE TABLE "port_hopping_configs" (
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "config_profile_inbound_uuid" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pool_start" INTEGER NOT NULL,
    "pool_end" INTEGER NOT NULL,
    "ports_per_user" INTEGER NOT NULL,
    "hop_interval_seconds" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "port_hopping_configs_pkey" PRIMARY KEY ("uuid"),
    CONSTRAINT "port_hopping_configs_valid_pool" CHECK (
        "pool_start" BETWEEN 1 AND 65535
        AND "pool_end" BETWEEN 1 AND 65535
        AND "pool_start" <= "pool_end"
        AND "ports_per_user" BETWEEN 2 AND 1024
        AND "ports_per_user" <= ("pool_end" - "pool_start" + 1)
        AND "hop_interval_seconds" BETWEEN 1 AND 86400
    )
);

CREATE UNIQUE INDEX "port_hopping_configs_config_profile_inbound_uuid_key"
    ON "port_hopping_configs"("config_profile_inbound_uuid");

ALTER TABLE "port_hopping_configs"
    ADD CONSTRAINT "port_hopping_configs_config_profile_inbound_uuid_fkey"
    FOREIGN KEY ("config_profile_inbound_uuid")
    REFERENCES "config_profile_inbounds"("uuid")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_routes"
    ADD COLUMN "port_hopping_config_uuid" UUID,
    ADD COLUMN "hop_start_port" INTEGER,
    ADD COLUMN "hop_end_port" INTEGER,
    ADD CONSTRAINT "user_routes_hopping_allocation_complete" CHECK (
        ("port_hopping_config_uuid" IS NULL AND "hop_start_port" IS NULL AND "hop_end_port" IS NULL)
        OR
        ("port_hopping_config_uuid" IS NOT NULL
         AND "hop_start_port" BETWEEN 1 AND 65535
         AND "hop_end_port" BETWEEN 1 AND 65535
         AND "hop_start_port" <= "hop_end_port")
    );

CREATE INDEX "user_routes_port_hopping_config_uuid_idx"
    ON "user_routes"("port_hopping_config_uuid");

CREATE UNIQUE INDEX "user_routes_port_hopping_config_uuid_node_uuid_hop_start_port_hop_end_port_key"
    ON "user_routes"("port_hopping_config_uuid", "node_uuid", "hop_start_port", "hop_end_port");

ALTER TABLE "user_routes"
    ADD CONSTRAINT "user_routes_port_hopping_config_uuid_fkey"
    FOREIGN KEY ("port_hopping_config_uuid")
    REFERENCES "port_hopping_configs"("uuid")
    ON DELETE SET NULL ON UPDATE CASCADE;
