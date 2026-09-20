import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';

import { PortRangeAllocator } from '../../src/modules/user-routes/port-range-allocator.service';
import { UserRoutesService } from '../../src/modules/user-routes/user-routes.service';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NODE_UUID = uuid(1);
const INBOUND_UUID = uuid(2);
const PROFILE_UUID = uuid(3);
const HOST_UUID = uuid(4);
const HOPPING_UUID = uuid(5);
const OTHER_HOPPING_UUID = uuid(6);
const ROUTE_UUID = uuid(7);

const hoppingRuntime = (applied = true, error: string | null = null) => ({
    mode: 'nftables' as const,
    available: true,
    applied,
    requiresNetAdmin: true as const,
    rules: applied ? 200 : 0,
    error,
});

const createBody = (portHoppingConfigUuid: string | null = null) => ({
    userId: 6,
    nodeUuid: NODE_UUID,
    configProfileInboundUuid: INBOUND_UUID,
    hostUuid: HOST_UUID,
    speedLimitUuid: null,
    portHoppingConfigUuid,
    internalAddress: '127.0.0.1',
    internalPort: 35_579,
    network: 'udp' as const,
    enabled: true,
});

function serviceFixture({
    initialHoppingUuid = null as string | null,
    hoppingEnabled = true,
    runtimePortHoppingApplied = true,
} = {}) {
    let route: Record<string, any> | null = initialHoppingUuid
        ? {
              uuid: ROUTE_UUID,
              userId: 6n,
              nodeUuid: NODE_UUID,
              configProfileInboundUuid: INBOUND_UUID,
              hostUuid: HOST_UUID,
              speedLimitUuid: null,
              portHoppingConfigUuid: initialHoppingUuid,
              externalPort: 32_000,
              internalAddress: '127.0.0.1',
              internalPort: 35_579,
              network: 'udp',
              enabled: true,
              hopStartPort: 50_000,
              hopEndPort: 50_199,
              speedLimit: null,
              portHoppingConfig: { enabled: true, hopIntervalSeconds: 30 },
          }
        : null;
    const requests: Array<{ forwards: Array<Record<string, unknown>> }> = [];
    const allocations: string[] = [];
    let releases = 0;
    let deletes = 0;
    const prisma = {
        users: { findUnique: async () => ({ id: 6n }) },
        nodes: { findUnique: async () => ({ uuid: NODE_UUID }) },
        configProfileInbounds: {
            findUnique: async () => ({
                uuid: INBOUND_UUID,
                profileUuid: PROFILE_UUID,
                port: 35_579,
                rawInbound: {
                    type: 'hysteria2',
                    tag: 'singbox-hysteria2-test',
                    listen: '127.0.0.1',
                    listen_port: 35_579,
                },
                profile: { coreType: 'singbox' },
            }),
        },
        hosts: {
            findUnique: async () => ({
                uuid: HOST_UUID,
                configProfileUuid: PROFILE_UUID,
                configProfileInboundUuid: INBOUND_UUID,
                nodes: [],
            }),
        },
        speedLimits: { findUnique: async () => ({ uuid: uuid(20) }) },
        configProfileInboundsToNodes: { findUnique: async () => ({}) },
        portHoppingConfigs: {
            findUnique: async ({ where }: { where: { uuid: string } }) => ({
                uuid: where.uuid,
                enabled: hoppingEnabled,
                configProfileInbound: {
                    uuid: INBOUND_UUID,
                    rawInbound: { type: 'hysteria2' },
                    profile: { coreType: 'singbox' },
                },
            }),
        },
        userRoutes: { findMany: async () => [] },
    };
    const repository = {
        hasOverlappingRoute: async () => false,
        listPorts: async () => [],
        create: async (data: Record<string, unknown>) => {
            route = {
                ...data,
                speedLimit: null,
                portHoppingConfigUuid: null,
                hopStartPort: null,
                hopEndPort: null,
                portHoppingConfig: null,
            };
            return route;
        },
        findByUuid: async () => route,
        findRuntimeByNodeUuid: async () => (route ? [route] : []),
        update: async (_uuid: string, data: Record<string, unknown>) => {
            if (!route) throw new Error('Missing route');
            Object.assign(route, data);
            if (data.portHoppingConfigUuid === null) route.portHoppingConfig = null;
            return route;
        },
        delete: async () => {
            deletes += 1;
            route = null;
        },
    };
    const allocator = {
        detectConflict: async () => [],
        allocate: async (_routeUuid: string, configUuid: string) => {
            if (!route) throw new Error('Missing route');
            allocations.push(configUuid);
            route.portHoppingConfigUuid = configUuid;
            route.hopStartPort = 50_000;
            route.hopEndPort = 50_199;
            route.portHoppingConfig = { enabled: true, hopIntervalSeconds: 30 };
            return { start: 50_000, end: 50_199 };
        },
        release: async () => {
            if (!route) throw new Error('Missing route');
            releases += 1;
            route.portHoppingConfigUuid = null;
            route.hopStartPort = null;
            route.hopEndPort = null;
            route.portHoppingConfig = null;
        },
        restoreDesiredState: async () => ({ allocations: [], issues: [] }),
    };
    const axios = {
        syncGostForwards: async (request: { forwards: Array<Record<string, unknown>> }) => {
            requests.push(structuredClone(request));
            return {
                isOk: true,
                response: {
                    applied: true,
                    running: true,
                    installed: true,
                    gostVersion: '3.3.0',
                    services: request.forwards.length,
                    configPath: '/var/lib/rnode/gost/config.json',
                    error: null,
                    portHopping: hoppingRuntime(
                        runtimePortHoppingApplied,
                        runtimePortHoppingApplied ? null : 'nftables check failed',
                    ),
                },
            };
        },
        getNodeTransportInitializationStatus: () => 'initialized',
    };
    const service = new UserRoutesService(
        prisma as never,
        repository as never,
        axios as never,
        {
            findByUUID: async () => ({
                uuid: NODE_UUID,
                address: 'node.invalid',
                port: 2222,
                proxyUrl: null,
            }),
        } as never,
        allocator as never,
    );
    return {
        service,
        requests,
        allocations,
        releases: () => releases,
        deletes: () => deletes,
        route: () => route,
    };
}

test('allocation lock casts PostgreSQL void to text before Prisma deserialization', async () => {
    let lockSql = '';
    let updated: Record<string, unknown> | undefined;
    const route = { uuid: ROUTE_UUID, nodeUuid: NODE_UUID };
    const tx = {
        userRoutes: {
            findUnique: async () => route,
            findUniqueOrThrow: async () => ({ ...route, portHoppingConfigUuid: null }),
            findMany: async () => [],
            update: async ({ data }: { data: Record<string, unknown> }) => {
                updated = data;
                return { ...route, ...data };
            },
        },
        portHoppingConfigs: {
            findUnique: async () => ({
                uuid: HOPPING_UUID,
                enabled: true,
                poolStart: 50_000,
                poolEnd: 51_999,
                portsPerUser: 200,
                hopIntervalSeconds: 30,
            }),
        },
        hostsToNodes: { findMany: async () => [] },
        configProfileInboundsToNodes: { findMany: async () => [] },
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
            lockSql = strings.reduce(
                (sql, part, index) =>
                    sql + part + (index < values.length ? String(values[index]) : ''),
                '',
            );
            return [{ lock: '' }];
        },
    };
    const prisma = {
        $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx),
    };

    const result = await new PortRangeAllocator(prisma as never).allocate(ROUTE_UUID, HOPPING_UUID);

    assert.deepEqual(result, { start: 50_000, end: 50_199 });
    assert.match(lockSql, /pg_advisory_xact_lock/);
    assert.match(lockSql, /::text AS lock/);
    assert.match(lockSql, new RegExp(`${HOPPING_UUID}:${NODE_UUID}`));
    assert.deepEqual(updated, {
        portHoppingConfigUuid: HOPPING_UUID,
        hopStartPort: 50_000,
        hopEndPort: 50_199,
    });
});

test('create HY2 route works with and without hopping and sends the expected Node payload', async () => {
    const canonical = serviceFixture();
    assert.equal((await canonical.service.create(createBody())).isOk, true);
    assert.deepEqual(canonical.allocations, []);
    assert.equal(canonical.requests[0].forwards[0].hopStartPort, undefined);

    const hopping = serviceFixture();
    assert.equal((await hopping.service.create(createBody(HOPPING_UUID))).isOk, true);
    assert.deepEqual(hopping.allocations, [HOPPING_UUID]);
    assert.equal(hopping.requests[0].forwards[0].externalPort, 32_000);
    assert.equal(hopping.requests[0].forwards[0].internalAddress, '127.0.0.1');
    assert.equal(hopping.requests[0].forwards[0].internalPort, 35_579);
    assert.equal(hopping.requests[0].forwards[0].hopStartPort, 50_000);
    assert.equal(hopping.requests[0].forwards[0].hopEndPort, 50_199);
    assert.equal(hopping.requests[0].forwards[0].hopIntervalSeconds, 30);
});

test('invalid hopping config is rejected before route insert or Node sync', async () => {
    const f = serviceFixture({ hoppingEnabled: false });
    const result = await f.service.create(createBody(HOPPING_UUID));

    assert.equal(result.isOk, false);
    if (!result.isOk) assert.equal(result.code, 'A266');
    assert.equal(f.route(), null);
    assert.deepEqual(f.requests, []);
});

test('edit binds, changes and disables hopping without recreating the route', async () => {
    const f = serviceFixture();
    assert.equal((await f.service.create(createBody())).isOk, true);
    const routeUuid = f.route()!.uuid;

    assert.equal(
        (await f.service.update({ uuid: routeUuid, portHoppingConfigUuid: HOPPING_UUID })).isOk,
        true,
    );
    assert.equal(f.route()!.uuid, routeUuid);
    assert.equal(f.route()!.portHoppingConfigUuid, HOPPING_UUID);

    assert.equal(
        (await f.service.update({ uuid: routeUuid, portHoppingConfigUuid: OTHER_HOPPING_UUID }))
            .isOk,
        true,
    );
    assert.equal(f.route()!.uuid, routeUuid);
    assert.equal(f.route()!.portHoppingConfigUuid, OTHER_HOPPING_UUID);

    assert.equal(
        (await f.service.update({ uuid: routeUuid, portHoppingConfigUuid: null })).isOk,
        true,
    );
    assert.equal(f.route()!.uuid, routeUuid);
    assert.equal(f.route()!.portHoppingConfigUuid, null);
    assert.equal(f.route()!.hopStartPort, null);
    assert.deepEqual(f.allocations, [HOPPING_UUID, OTHER_HOPPING_UUID]);
    assert.equal(f.releases(), 3);
});

test('Node nftables rejection compensates a newly created hopping route', async () => {
    const f = serviceFixture({ runtimePortHoppingApplied: false });
    const result = await f.service.create(createBody(HOPPING_UUID));

    assert.equal(result.isOk, false);
    if (!result.isOk) {
        assert.equal(result.code, 'A271');
        assert.equal(result.message, 'nftables check failed');
        assert.equal(result.httpCode, 502);
    }
    assert.equal(f.requests.length, 1);
    assert.equal(f.deletes(), 1);
    assert.equal(f.route(), null);
});

test('deleting a hopping route syncs an empty desired state before database cleanup', async () => {
    const f = serviceFixture({ initialHoppingUuid: HOPPING_UUID });
    const result = await f.service.delete(ROUTE_UUID);

    assert.equal(result.isOk, true);
    assert.deepEqual(f.requests, [{ forwards: [] }]);
    assert.equal(f.deletes(), 1);
});
