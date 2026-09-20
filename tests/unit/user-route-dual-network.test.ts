import assert from 'node:assert/strict';
import test from 'node:test';

import { UserRoutesRepository } from '../../src/modules/user-routes/repositories/user-routes.repository';
import {
    resolveUserRouteNetwork,
    splitUserRouteNetwork,
} from '../../src/modules/user-routes/user-route-network';

test('SS2022 transport derives both networks unless the core explicitly restricts it', () => {
    assert.equal(resolveUserRouteNetwork({ type: 'shadowsocks' }), 'tcp,udp');
    assert.equal(
        resolveUserRouteNetwork({ protocol: 'shadowsocks', settings: { network: 'udp' } }),
        'udp',
    );
    assert.equal(resolveUserRouteNetwork({ type: 'shadowsocks', network: 'tcp' }), 'tcp');
    assert.equal(resolveUserRouteNetwork({ type: 'hysteria2' }), 'udp');
    assert.equal(resolveUserRouteNetwork({ type: 'vless' }), 'tcp');
    assert.deepEqual(splitUserRouteNetwork('tcp,udp'), ['tcp', 'udp']);
    assert.throws(() => splitUserRouteNetwork('unknown'));
});

test('port reservations intersect TCP+UDP with both existing single-network route sets', async () => {
    const requested: unknown[] = [];
    const repository = new UserRoutesRepository(
        {
            userRoutes: {
                findMany: async (query: unknown) => {
                    requested.push(query);
                    return [{ externalPort: 32000 }];
                },
            },
            hostsToNodes: { findMany: async () => [] },
            configProfileInboundsToNodes: { findMany: async () => [] },
        } as never,
        {} as never,
    );
    for (const network of ['tcp', 'udp', 'tcp,udp']) {
        assert.deepEqual(await repository.listPorts('node', network), [32000]);
    }
    assert.deepEqual(
        requested,
        ['tcp', 'udp', 'tcp,udp'].map((network) => ({
            where: {
                nodeUuid: 'node',
                network: {
                    in: network === 'tcp,udp' ? ['tcp', 'udp', 'tcp,udp'] : [network, 'tcp,udp'],
                },
            },
            select: { externalPort: true },
        })),
    );
});

test('overlapping route identities include existing single and combined network selections', async () => {
    let query: unknown;
    const repository = new UserRoutesRepository(
        {
            userRoutes: {
                findFirst: async (value: unknown) => {
                    query = value;
                    return { uuid: 'existing' };
                },
            },
        } as never,
        {} as never,
    );
    assert.equal(
        await repository.hasOverlappingRoute(
            {
                nodeUuid: 'node',
                userId: 1,
                hostUuid: 'host',
                configProfileInboundUuid: 'ib',
                network: 'tcp,udp',
            },
            'self',
        ),
        true,
    );
    assert.deepEqual(query, {
        where: {
            nodeUuid: 'node',
            userId: 1n,
            hostUuid: 'host',
            configProfileInboundUuid: 'ib',
            network: { in: ['tcp', 'udp', 'tcp,udp'] },
            uuid: { not: 'self' },
        },
        select: { uuid: true },
    });
});
