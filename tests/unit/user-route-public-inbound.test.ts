import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';

import { CreateUserRouteCommand } from '../../libs/contract/commands/user-routes/create-user-route.command';
import { isUserRouteListenerAllowed } from '../../src/modules/user-routes/user-route-listener';
import { UserRoutesService } from '../../src/modules/user-routes/user-routes.service';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const body = {
    userId: 6,
    nodeUuid: uuid(1),
    configProfileInboundUuid: uuid(2),
    hostUuid: uuid(3),
    internalAddress: '127.0.0.1',
    internalPort: 34397,
    network: 'tcp' as const,
    enabled: true,
};

function fixture(listen: unknown = '0.0.0.0', coreType = 'xray', protocol = 'vless') {
    const rawInbound =
        coreType === 'singbox'
            ? { listen, listen_port: 34397, type: protocol, tag: 'test-sb' }
            : { listen, port: 34397, protocol, tag: 'test-xray' };
    const original = JSON.stringify(rawInbound);
    let stored: Record<string, unknown> | null = null;
    const requests: unknown[] = [];
    const prisma = {
        users: { findUnique: async () => ({ id: 6n }) },
        nodes: { findUnique: async () => ({ uuid: uuid(1) }) },
        configProfileInbounds: {
            findUnique: async () => ({
                uuid: uuid(2),
                profileUuid: uuid(4),
                port: 34397,
                rawInbound,
                profile: { coreType },
            }),
        },
        hosts: {
            findUnique: async () => ({
                uuid: uuid(3),
                configProfileUuid: uuid(4),
                configProfileInboundUuid: uuid(2),
                nodes: [],
            }),
        },
        configProfileInboundsToNodes: { findUnique: async () => ({}) },
    };
    const repository = {
        hasOverlappingRoute: async () => false,
        listPorts: async () => [],
        create: async (data: Record<string, unknown>) => {
            stored = { ...data, hopStartPort: null, hopEndPort: null };
            return stored;
        },
        findByUuid: async () => stored,
        findRuntimeByNodeUuid: async () => (stored ? [stored] : []),
    };
    const service = new UserRoutesService(
        prisma as never,
        repository as never,
        {
            syncGostForwards: async (request: unknown) => {
                requests.push(request);
                return { isOk: true, response: { applied: true } };
            },
        } as never,
        {
            findByUUID: async () => ({
                address: 'node.invalid',
                port: 2222,
                proxyUrl: null,
            }),
        } as never,
        {
            detectConflict: async () => [],
            restoreDesiredState: async () => ({ issues: [] }),
        } as never,
    );
    return {
        service,
        requests,
        stored: () => stored,
        assertUnchanged: () => assert.equal(JSON.stringify(rawInbound), original),
    };
}

test('create DTO preserves explicit opt-in; old clients remain strict by default', () => {
    assert.equal(
        CreateUserRouteCommand.RequestBodySchema.parse(body).allowPublicInbound,
        undefined,
    );
    assert.equal(
        CreateUserRouteCommand.RequestBodySchema.parse({ ...body, allowPublicInbound: true })
            .allowPublicInbound,
        true,
    );
    assert.equal(
        CreateUserRouteCommand.RequestBodySchema.safeParse({ ...body, allowPublicInbound: 'true' })
            .success,
        false,
    );
});

test('SS2022 TCP+UDP routes allocate one external port and sync both networks for either core', async () => {
    for (const core of ['xray', 'singbox']) {
        const f = fixture('127.0.0.1', core, 'shadowsocks');
        const result = await f.service.create({ ...body, network: 'tcp,udp' });
        assert.equal(result.isOk, true);
        assert.equal(f.stored()?.network, 'tcp,udp');
        const forwards = (
            f.requests[0] as { forwards: { id: string; externalPort: number; network: string }[] }
        ).forwards;
        assert.deepEqual(
            forwards.map((item) => item.network),
            ['tcp', 'udp'],
        );
        assert.equal(forwards[0].id, forwards[1].id);
        assert.equal(forwards[0].externalPort, forwards[1].externalPort);
        f.assertUnchanged();
    }
    const f = fixture('127.0.0.1', 'singbox');
    assert.equal((await f.service.create({ ...body, network: 'tcp,udp' })).isOk, false);
    assert.equal(f.stored(), null);
});

test('Xray public listener requires explicit opt-in before insert or Node sync', async () => {
    for (const allowPublicInbound of [undefined, false]) {
        const f = fixture();
        const result = await f.service.create({ ...body, allowPublicInbound });
        assert.equal(result.isOk, false);
        assert.equal(f.stored(), null);
        assert.deepEqual(f.requests, []);
        f.assertUnchanged();
    }
});

test('opted-in Xray public listener creates automatic-port route and syncs only to loopback', async () => {
    const f = fixture();
    const result = await f.service.create({ ...body, allowPublicInbound: true });
    assert.equal(result.isOk, true);
    assert.equal(f.stored()?.externalPort, 32000);
    assert.equal(f.stored()?.internalAddress, '127.0.0.1');
    assert.equal(f.stored()?.internalPort, 34397);
    assert.equal(Object.hasOwn(f.stored()!, 'allowPublicInbound'), false);
    assert.deepEqual(f.requests, [
        {
            forwards: [
                {
                    id: f.stored()?.uuid,
                    externalPort: 32000,
                    internalAddress: '127.0.0.1',
                    internalPort: 34397,
                    network: 'tcp',
                    downloadBytesPerSecond: 0,
                    uploadBytesPerSecond: 0,
                    enabled: true,
                },
            ],
        },
    ]);
    f.assertUnchanged();
});

test('compatibility never accepts public targets, mismatched loopback or arbitrary listeners', async () => {
    for (const internalAddress of ['0.0.0.0', '::1', '192.0.2.1', 'localhost']) {
        const f = fixture();
        assert.equal(
            (await f.service.create({ ...body, internalAddress, allowPublicInbound: true })).isOk,
            false,
        );
        assert.equal(f.stored(), null);
        assert.deepEqual(f.requests, []);
    }
    for (const listen of [undefined, '', '::', '192.0.2.1', 'localhost']) {
        const f = fixture(listen === undefined ? null : listen);
        assert.equal((await f.service.create({ ...body, allowPublicInbound: true })).isOk, false);
        assert.deepEqual(f.requests, []);
    }
});

test('unknown cores cannot opt into public compatibility', async () => {
    for (const coreType of ['unknown']) {
        const f = fixture('0.0.0.0', coreType);
        assert.equal((await f.service.create({ ...body, allowPublicInbound: true })).isOk, false);
        assert.equal(f.stored(), null);
    }
});

test('both cores accept only explicit wildcard opt-in with the matching loopback family', async () => {
    for (const coreType of ['xray', 'singbox']) {
        const f = fixture('0.0.0.0', coreType);
        assert.equal((await f.service.create({ ...body, allowPublicInbound: true })).isOk, true);
        f.assertUnchanged();
        for (const [listen, internalAddress] of [
            ['::', '::1'],
            ['0.0.0.0', '127.0.0.1'],
        ]) {
            assert.equal(
                isUserRouteListenerAllowed({
                    listen,
                    internalAddress,
                    coreType,
                    allowPublicInbound: true,
                }),
                true,
            );
            assert.equal(isUserRouteListenerAllowed({ listen, internalAddress, coreType }), false);
        }
    }
});

test('existing explicit loopback routes still work without opting in', async () => {
    for (const coreType of ['xray', 'singbox']) {
        const f = fixture('127.0.0.1', coreType);
        assert.equal((await f.service.create(body)).isOk, true);
        f.assertUnchanged();
    }
    assert.equal(
        isUserRouteListenerAllowed({ listen: '::1', internalAddress: '::1', coreType: 'xray' }),
        true,
    );
    assert.equal(
        isUserRouteListenerAllowed({
            listen: '::1',
            internalAddress: '127.0.0.1',
            coreType: 'xray',
        }),
        false,
    );
});
