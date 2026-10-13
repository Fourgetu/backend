import assert from 'node:assert/strict';
import test from 'node:test';

import { NodesService } from '../../src/modules/nodes/nodes.service';

const fixture = (isDisabled = false) => {
    const starts: unknown[] = [];
    const inboundChanges: string[][] = [];
    let saved: Record<string, unknown> = {
        uuid: 'node',
        id: 1,
        name: 'original',
        isDisabled,
        consumptionMultiplier: 1_000_000_000n,
        nodeConsumptionMultiplier: 1_000_000_000n,
        activeConfigProfileUuid: 'xray-profile',
        activeSingBoxConfigProfileUuid: 'singbox-profile',
        activeInbounds: [
            { uuid: 'xray-inbound', profileUuid: 'xray-profile' },
            { uuid: 'singbox-inbound', profileUuid: 'singbox-profile' },
        ],
    };
    const service = new NodesService(
        {
            findByUUID: async () => saved,
            update: async (value: Record<string, unknown>) => {
                saved = {
                    ...saved,
                    ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)),
                };
                return saved;
            },
            removeInboundsFromNode: async () => {},
            addInboundsToNode: async (_uuid: string, inbounds: string[]) =>
                inboundChanges.push(inbounds),
        } as never,
        { emit: () => {} } as never,
        { startNode: async (request: unknown) => starts.push(request) } as never,
        {
            execute: async (query: { uuid: string }) => ({
                isOk: true,
                response: {
                    coreType: query.uuid === 'xray-profile' ? 'xray' : 'singbox',
                    inbounds: [{ uuid: 'new-inbound' }],
                },
            }),
        } as never,
        {} as never,
        { getOne: async () => ({}) } as never,
    );
    return { service, starts, inboundChanges, getSaved: () => saved };
};

test('editing display and billing fields does not start either core', async () => {
    const { service, starts, inboundChanges, getSaved } = fixture();
    const result = await service.updateNode({
        uuid: 'node',
        name: '  renamed  ',
        note: 'billing note',
        providerUuid: null,
        trafficLimitBytes: 0,
        isTrafficTrackingActive: false,
    });
    assert.equal(result.isOk, true);
    assert.equal(getSaved().name, 'renamed');
    assert.equal(getSaved().trafficLimitBytes, 0n);
    assert.deepEqual(starts, []);
    assert.deepEqual(inboundChanges, []);
});

test('changing either core binding schedules application and preserves the other core inbounds', async () => {
    for (const field of ['configProfile', 'singBoxConfigProfile'] as const) {
        const { service, starts, inboundChanges } = fixture();
        const result = await service.updateNode({
            uuid: 'node',
            [field]: {
                activeConfigProfileUuid:
                    field === 'configProfile' ? 'xray-profile' : 'singbox-profile',
                activeInbounds: ['new-inbound'],
            },
        });
        assert.equal(result.isOk, true);
        assert.equal(starts.length, 1);
        assert.deepEqual(inboundChanges, [
            [field === 'configProfile' ? 'singbox-inbound' : 'xray-inbound', 'new-inbound'],
        ]);
    }
});

test('clearing either core schedules application instead of treating null as unchanged', async () => {
    for (const field of ['configProfile', 'singBoxConfigProfile'] as const) {
        const { service, starts, inboundChanges, getSaved } = fixture();
        assert.equal((await service.updateNode({ uuid: 'node', [field]: null })).isOk, true);
        assert.equal(starts.length, 1);
        const cleared =
            field === 'configProfile'
                ? 'activeConfigProfileUuid'
                : 'activeSingBoxConfigProfileUuid';
        assert.equal(getSaved()[cleared], null);
        assert.deepEqual(inboundChanges, [
            [field === 'configProfile' ? 'singbox-inbound' : 'xray-inbound'],
        ]);
    }
});

test('runtime fields including empty integrations and cleared plugin/proxy still apply', async () => {
    for (const patch of [
        { address: '  edge.example.com  ' },
        { port: 3000 },
        { proxyUrl: null },
        { activePluginUuid: null },
        { integrationUuids: [] },
    ]) {
        const { service, starts } = fixture();
        assert.equal((await service.updateNode({ uuid: 'node', ...patch })).isOk, true);
        assert.deepEqual(starts, [{ nodeUuid: 'node', force: 'integrationUuids' in patch }]);
    }
});

test('disabled nodes save runtime changes without starting', async () => {
    const { service, starts } = fixture(true);
    assert.equal(
        (await service.updateNode({ uuid: 'node', singBoxConfigProfile: null })).isOk,
        true,
    );
    assert.deepEqual(starts, []);
});
