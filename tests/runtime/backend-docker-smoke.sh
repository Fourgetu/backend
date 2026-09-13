#!/bin/sh

set -eu

backend_image=${BACKEND_IMAGE:-remnawave/backend:runtime-smoke}
stability_seconds=${STABILITY_SECONDS:-60}
startup_timeout_seconds=${STARTUP_TIMEOUT_SECONDS:-240}
suffix="$(date +%s)-$$"
network_name="rw-smoke-${suffix}"
database_container="rw-smoke-db-${suffix}"
valkey_container="rw-smoke-valkey-${suffix}"
backend_container="rw-smoke-backend-${suffix}"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

container_exists() {
    docker container inspect "$1" >/dev/null 2>&1
}

cleanup() {
    exit_code=$?
    trap - EXIT INT TERM

    if [ "$exit_code" -ne 0 ] && container_exists "$backend_container"; then
        echo "--- backend logs ---" >&2
        docker logs "$backend_container" >&2 || true
    fi

    docker rm -f "$backend_container" "$valkey_container" "$database_container" \
        >/dev/null 2>&1 || true
    docker network rm "$network_name" >/dev/null 2>&1 || true
    exit "$exit_code"
}

trap cleanup EXIT INT TERM

pm2_snapshot() {
    docker exec "$backend_container" node -e '
        const { execFileSync } = require("node:child_process");
        const output = execFileSync("pm2", ["jlist"], { encoding: "utf8" });
        const jsonStart = output.indexOf("[");
        if (jsonStart < 0) throw new Error("pm2 jlist did not return JSON");
        const processes = JSON.parse(output.slice(jsonStart));
        const expected = ["remnawave-api", "remnawave-jobs", "remnawave-scheduler"];
        for (const name of expected) {
            const matches = processes.filter((process) => process.name === name);
            if (matches.length === 0) throw new Error(`${name} is missing from PM2`);
            for (const process of matches) {
                if (process.pm2_env.status !== "online" || !process.pid) {
                    throw new Error(`${name} is not stably online: ${process.pm2_env.status}`);
                }
            }
        }
        const snapshot = processes
            .filter((process) => expected.includes(process.name))
            .map((process) => `${process.name}:${process.pm_id}:${process.pm2_env.restart_time}`)
            .sort();
        console.log(snapshot.join("\n"));
    '
}

healthcheck() {
    docker exec "$backend_container" \
        curl --fail --silent --show-error http://127.0.0.1:3001/health >/dev/null
}

api_check() {
    docker exec "$backend_container" \
        curl --fail --silent --show-error \
        --header 'X-Forwarded-For: 127.0.0.1' \
        --header 'X-Forwarded-Proto: https' \
        http://127.0.0.1:3000/ >/dev/null
}

echo "Creating isolated Docker network: $network_name"
docker network create "$network_name" >/dev/null

docker run --detach --name "$database_container" \
    --network "$network_name" --network-alias remnawave-db \
    --env POSTGRES_USER=remnawave \
    --env POSTGRES_PASSWORD=runtime-smoke-password \
    --env POSTGRES_DB=remnawave \
    postgres:18.4 >/dev/null

docker run --detach --name "$valkey_container" \
    --network "$network_name" --network-alias remnawave-valkey \
    valkey/valkey:9-alpine \
    valkey-server --save "" --appendonly no --maxmemory-policy noeviction \
    --loglevel warning >/dev/null

echo "Waiting for PostgreSQL and Valkey..."
deadline=$(( $(date +%s) + startup_timeout_seconds ))
until docker exec "$database_container" pg_isready -U remnawave -d remnawave >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$deadline" ] || fail "PostgreSQL did not become ready"
    sleep 2
done
until docker exec "$valkey_container" valkey-cli ping 2>/dev/null | grep -qx PONG; do
    [ "$(date +%s)" -lt "$deadline" ] || fail "Valkey did not become ready"
    sleep 2
done

echo "Starting Backend image: $backend_image"
docker run --detach --name "$backend_container" \
    --network "$network_name" \
    --env API_INSTANCES=1 \
    --env WORKER_INSTANCES=1 \
    --env DATABASE_URL=postgresql://remnawave:runtime-smoke-password@remnawave-db:5432/remnawave \
    --env REDIS_HOST=remnawave-valkey \
    --env REDIS_PORT=6379 \
    --env REDIS_DB=1 \
    --env APP_SECRET=runtime-smoke-app-secret \
    --env FRONT_END_DOMAIN='*' \
    --env PANEL_DOMAIN=localhost \
    --env SUB_PUBLIC_DOMAIN=localhost/api/sub \
    --env METRICS_USER=runtime-smoke \
    --env METRICS_PASS=runtime-smoke-password \
    --env IS_TELEGRAM_NOTIFICATIONS_ENABLED=false \
    --env WEBHOOK_ENABLED=false \
    "$backend_image" >/dev/null

echo "Waiting for the scheduler health endpoint and all PM2 processes..."
deadline=$(( $(date +%s) + startup_timeout_seconds ))
while :; do
    running=$(docker inspect --format '{{.State.Running}}' "$backend_container" 2>/dev/null || true)
    [ "$running" = true ] || fail "Backend container exited during startup"

    if healthcheck && api_check && snapshot=$(pm2_snapshot 2>/dev/null); then
        break
    fi

    [ "$(date +%s)" -lt "$deadline" ] || fail "Backend runtime did not become healthy"
    sleep 3
done

initial_container_restarts=$(docker inspect --format '{{.RestartCount}}' "$backend_container")
initial_pm2_snapshot=$snapshot

echo "All three processes are online. Monitoring stability for ${stability_seconds}s..."
elapsed=0
while [ "$elapsed" -lt "$stability_seconds" ]; do
    sleep_interval=5
    remaining=$((stability_seconds - elapsed))
    if [ "$remaining" -lt "$sleep_interval" ]; then
        sleep_interval=$remaining
    fi
    sleep "$sleep_interval"
    elapsed=$((elapsed + sleep_interval))

    running=$(docker inspect --format '{{.State.Running}}' "$backend_container" 2>/dev/null || true)
    [ "$running" = true ] || fail "Backend container stopped during stability window"
    healthcheck || fail "Health endpoint failed during stability window"
    api_check || fail "REST/API endpoint failed during stability window"

    current_pm2_snapshot=$(pm2_snapshot) || fail "A PM2 process is not online"
    [ "$current_pm2_snapshot" = "$initial_pm2_snapshot" ] || \
        fail "A PM2 process restart count changed during stability window"
done

final_container_restarts=$(docker inspect --format '{{.RestartCount}}' "$backend_container")
[ "$final_container_restarts" = "$initial_container_restarts" ] || \
    fail "Backend container restart count changed"

backend_logs=$(docker logs "$backend_container" 2>&1)
if printf '%s\n' "$backend_logs" | grep -E \
    "Nest can't resolve dependencies|Environment Configuration Errors|unhandledRejection" \
    >/dev/null; then
    fail "Backend logs contain a dependency injection, configuration, or unhandled rejection error"
fi

printf '%s\n' "$backend_logs" | grep -E \
    '\[rest-[^]]+\].*Nest application successfully started' >/dev/null || \
    fail "REST/API startup completion was not found in logs"
printf '%s\n' "$backend_logs" | grep -E \
    '\[work-[^]]+\].*Nest application successfully started' >/dev/null || \
    fail "Jobs/Worker startup completion was not found in logs"
printf '%s\n' "$backend_logs" | grep -E \
    '\[cron-[^]]+\].*Nest application successfully started' >/dev/null || \
    fail "Scheduler/Cron startup completion was not found in logs"

printf '%s\n' "$initial_pm2_snapshot"
echo "PASS: REST/API process is online and did not restart"
echo "PASS: REST/API endpoint returned success throughout the ${stability_seconds}s window"
echo "PASS: Jobs/Worker process is online and did not restart"
echo "PASS: Scheduler/Cron process is online and did not restart"
echo "PASS: /health returned success throughout the ${stability_seconds}s window"
echo "PASS: Backend container restart count remained $final_container_restarts"
echo "PASS: logs confirm all three Nest applications completed startup"
echo "PASS: logs contain no Nest dependency, configuration, or unhandled rejection errors"
