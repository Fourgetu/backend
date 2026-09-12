-- CreateTable
CREATE TABLE "speed_limits" (
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "download_bytes_per_second" BIGINT NOT NULL DEFAULT 0,
    "upload_bytes_per_second" BIGINT NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "speed_limits_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "user_routes" (
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" BIGINT NOT NULL,
    "node_uuid" UUID NOT NULL,
    "config_profile_inbound_uuid" UUID NOT NULL,
    "host_uuid" UUID NOT NULL,
    "speed_limit_uuid" UUID,
    "external_port" INTEGER NOT NULL,
    "internal_address" TEXT NOT NULL DEFAULT '127.0.0.1',
    "internal_port" INTEGER NOT NULL,
    "gost_forward_id" VARCHAR(128),
    "gost_service_name" VARCHAR(128),
    "network" VARCHAR(16) NOT NULL DEFAULT 'tcp',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_routes_pkey" PRIMARY KEY ("uuid")
);

-- CreateIndex
CREATE UNIQUE INDEX "speed_limits_name_key" ON "speed_limits"("name");
CREATE UNIQUE INDEX "user_routes_user_id_node_uuid_config_profile_inbound_uuid_host_uuid_network_key"
    ON "user_routes"("user_id", "node_uuid", "config_profile_inbound_uuid", "host_uuid", "network");
CREATE UNIQUE INDEX "user_routes_node_uuid_external_port_network_key"
    ON "user_routes"("node_uuid", "external_port", "network");
CREATE INDEX "user_routes_user_id_idx" ON "user_routes"("user_id");
CREATE INDEX "user_routes_node_uuid_config_profile_inbound_uuid_idx"
    ON "user_routes"("node_uuid", "config_profile_inbound_uuid");
CREATE INDEX "user_routes_speed_limit_uuid_idx" ON "user_routes"("speed_limit_uuid");

-- AddForeignKey
ALTER TABLE "user_routes" ADD CONSTRAINT "user_routes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_routes" ADD CONSTRAINT "user_routes_node_uuid_fkey"
    FOREIGN KEY ("node_uuid") REFERENCES "nodes"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_routes" ADD CONSTRAINT "user_routes_config_profile_inbound_uuid_fkey"
    FOREIGN KEY ("config_profile_inbound_uuid") REFERENCES "config_profile_inbounds"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_routes" ADD CONSTRAINT "user_routes_host_uuid_fkey"
    FOREIGN KEY ("host_uuid") REFERENCES "hosts"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_routes" ADD CONSTRAINT "user_routes_speed_limit_uuid_fkey"
    FOREIGN KEY ("speed_limit_uuid") REFERENCES "speed_limits"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
