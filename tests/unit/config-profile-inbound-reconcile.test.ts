import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';

import { syncInbounds } from '../../prisma/seed/seeders/6_sync-inbounds';

const xrayProfile = {
    uuid: '00000000-0000-4000-8000-000000000001',
    name: 'lazy',
    coreType: 'xray',
    updatedAt: new Date('2026-09-18T00:00:00.000Z'),
    config: {
        inbounds: [
            {
                tag: 'vless-lazy',
                listen: '0.0.0.0',
                port: 34_397,
                protocol: 'vless',
                settings: { clients: [] },
                streamSettings: { network: 'raw' },
            },
        ],
        outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    },
};
const singBoxProfile = {
    uuid: '00000000-0000-4000-8000-000000000002',
    name: 'VMrack sing-box',
    coreType: 'singbox',
    updatedAt: new Date('2026-09-18T00:00:00.000Z'),
    config: {
        inbounds: [
            {
                type: 'hysteria2',
                tag: 'singbox-hysteria2-test',
                listen: '127.0.0.1',
                listen_port: 35_579,
                users: [],
                tls: { enabled: true, server_name: 'test.example.com' },
            },
        ],
        outbounds: [{ type: 'direct', tag: 'direct' }],
        route: { final: 'direct' },
    },
};

interface InboundRow {
    uuid: string;
    profileUuid: string;
    tag: string;
    type: string;
    network: string | null;
    security: string | null;
    port: number | null;
    rawInbound: unknown;
}

function fixture(initialInbounds: InboundRow[]) {
    const profiles = structuredClone([xrayProfile, singBoxProfile]);
    const originalProfiles = JSON.stringify(profiles);
    const inbounds = initialInbounds.map((inbound) => structuredClone(inbound));
    const operations = { creates: 0, deletes: 0, updates: 0 };
    let generated = 0;
    const prisma = {
        configProfiles: {
            findMany: async () => profiles,
        },
        configProfileInbounds: {
            findMany: async ({ where }: { where: { profileUuid: string } }) =>
                inbounds.filter((inbound) => inbound.profileUuid === where.profileUuid),
            deleteMany: async ({ where }: { where: { uuid: { in: string[] } } }) => {
                operations.deletes += where.uuid.in.length;
                for (const uuid of where.uuid.in) {
                    const index = inbounds.findIndex((inbound) => inbound.uuid === uuid);
                    if (index >= 0) inbounds.splice(index, 1);
                }
                return { count: where.uuid.in.length };
            },
            createMany: async ({ data }: { data: Array<Omit<InboundRow, 'uuid'>> }) => {
                operations.creates += data.length;
                for (const inbound of data) {
                    generated += 1;
                    inbounds.push({
                        ...structuredClone(inbound),
                        uuid: `00000000-0000-4000-8000-${String(100 + generated).padStart(12, '0')}`,
                    });
                }
                return { count: data.length };
            },
            update: async ({
                where,
                data,
            }: {
                where: { uuid: string };
                data: Partial<InboundRow>;
            }) => {
                operations.updates += 1;
                const inbound = inbounds.find((item) => item.uuid === where.uuid);
                if (!inbound) throw new Error('Missing inbound');
                Object.assign(inbound, structuredClone(data));
                return inbound;
            },
        },
    };
    return {
        prisma,
        profiles,
        inbounds,
        operations,
        assertProfilesUnchanged: () => assert.equal(JSON.stringify(profiles), originalProfiles),
    };
}

const xrayInbound: InboundRow = {
    uuid: '00000000-0000-4000-8000-000000000011',
    profileUuid: xrayProfile.uuid,
    tag: 'vless-lazy',
    type: 'vless',
    network: 'raw',
    security: null,
    port: 34_397,
    rawInbound: xrayProfile.config.inbounds[0],
};
const singBoxInbound: InboundRow = {
    uuid: '00000000-0000-4000-8000-000000000012',
    profileUuid: singBoxProfile.uuid,
    tag: 'singbox-hysteria2-test',
    type: 'hysteria2',
    network: 'udp',
    security: 'tls',
    port: 35_579,
    rawInbound: singBoxProfile.config.inbounds[0],
};

test('startup reconcile keeps existing Xray and sing-box projections and UUIDs', async () => {
    const f = fixture([xrayInbound, singBoxInbound]);

    await syncInbounds(f.prisma as never);
    await syncInbounds(f.prisma as never);

    assert.deepEqual(
        f.inbounds.map(({ uuid, profileUuid, tag }) => ({ uuid, profileUuid, tag })),
        [
            { uuid: xrayInbound.uuid, profileUuid: xrayProfile.uuid, tag: xrayInbound.tag },
            {
                uuid: singBoxInbound.uuid,
                profileUuid: singBoxProfile.uuid,
                tag: singBoxInbound.tag,
            },
        ],
    );
    assert.deepEqual(f.operations, { creates: 0, deletes: 0, updates: 0 });
    f.assertProfilesUnchanged();
});

test('startup reconcile hydrates a missing sing-box projection once without rewriting JSON', async () => {
    const f = fixture([xrayInbound]);
    const updatedAt = f.profiles[1].updatedAt.getTime();

    await syncInbounds(f.prisma as never);
    const hydrated = f.inbounds.find((inbound) => inbound.profileUuid === singBoxProfile.uuid);
    assert.ok(hydrated);
    assert.equal(hydrated.tag, 'singbox-hysteria2-test');
    assert.equal(hydrated.type, 'hysteria2');
    assert.equal(hydrated.network, 'udp');
    assert.equal(hydrated.security, 'tls');
    assert.equal(hydrated.port, 35_579);
    const hydratedUuid = hydrated.uuid;

    await syncInbounds(f.prisma as never);
    assert.equal(
        f.inbounds.find((inbound) => inbound.profileUuid === singBoxProfile.uuid)?.uuid,
        hydratedUuid,
    );
    assert.deepEqual(f.operations, { creates: 1, deletes: 0, updates: 0 });
    assert.equal(f.profiles[1].updatedAt.getTime(), updatedAt);
    f.assertProfilesUnchanged();
});

test('stale sing-box metadata is updated in place so downstream UUID relations remain valid', async () => {
    const stale = {
        ...singBoxInbound,
        network: null,
        security: null,
        port: null,
        rawInbound: { type: 'hysteria2', tag: singBoxInbound.tag },
    };
    const f = fixture([xrayInbound, stale]);
    const downstreamRelations = {
        hostInboundUuid: stale.uuid,
        nodeInboundUuid: stale.uuid,
        userRouteInboundUuid: stale.uuid,
    };

    await syncInbounds(f.prisma as never);

    const reconciled = f.inbounds.find((inbound) => inbound.uuid === stale.uuid);
    assert.ok(reconciled);
    assert.equal(reconciled.port, 35_579);
    assert.equal(reconciled.network, 'udp');
    assert.equal(reconciled.security, 'tls');
    assert.deepEqual(downstreamRelations, {
        hostInboundUuid: reconciled.uuid,
        nodeInboundUuid: reconciled.uuid,
        userRouteInboundUuid: reconciled.uuid,
    });
    assert.deepEqual(f.operations, { creates: 0, deletes: 0, updates: 1 });
    f.assertProfilesUnchanged();
});
