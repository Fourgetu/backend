import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileGostForwards } from '../../src/common/gost-runtime/reconcile-gost-forwards';

test('node reconnect reconcile restores enabled per-user hopping ranges', async () => {
    let query: unknown;
    let request: unknown;
    const prisma = {
        userRoutes: {
            findMany: async (value: unknown) => {
                query = value;
                return [
                    {
                        uuid: 'route-a',
                        externalPort: 32_001,
                        internalAddress: '127.0.0.1',
                        internalPort: 10_002,
                        network: 'udp',
                        enabled: true,
                        hopStartPort: 20_000,
                        hopEndPort: 20_019,
                        speedLimit: {
                            enabled: true,
                            downloadBytesPerSecond: 2_500_000n,
                            uploadBytesPerSecond: 1_250_000n,
                        },
                        portHoppingConfig: { enabled: true, hopIntervalSeconds: 30 },
                    },
                    {
                        uuid: 'route-disabled-hopping',
                        externalPort: 32_002,
                        internalAddress: '127.0.0.1',
                        internalPort: 10_002,
                        network: 'udp',
                        enabled: true,
                        hopStartPort: 20_020,
                        hopEndPort: 20_039,
                        speedLimit: null,
                        portHoppingConfig: { enabled: false, hopIntervalSeconds: 30 },
                    },
                ];
            },
        },
    };
    const axios = {
        syncGostForwards: async (value: unknown) => {
            request = value;
            return { isOk: true, response: { applied: true } };
        },
    };

    const result = await reconcileGostForwards(prisma as never, axios as never, 'node-a', {
        address: '127.0.0.1',
        port: 2222,
        proxyUrl: null,
    });

    assert.equal(result.isOk, true);
    if (result.isOk) assert.equal(result.response.requiresPortHopping, true);

    assert.deepEqual(query, {
        where: { nodeUuid: 'node-a' },
        include: {
            speedLimit: {
                select: {
                    downloadBytesPerSecond: true,
                    uploadBytesPerSecond: true,
                    enabled: true,
                },
            },
            portHoppingConfig: {
                select: { enabled: true, hopIntervalSeconds: true },
            },
        },
        orderBy: [{ externalPort: 'asc' }, { network: 'asc' }],
    });
    assert.deepEqual(request, {
        forwards: [
            {
                id: 'route-a',
                externalPort: 32_001,
                internalAddress: '127.0.0.1',
                internalPort: 10_002,
                network: 'udp',
                downloadBytesPerSecond: 2_500_000,
                uploadBytesPerSecond: 1_250_000,
                enabled: true,
                hopStartPort: 20_000,
                hopEndPort: 20_019,
                hopIntervalSeconds: 30,
            },
            {
                id: 'route-disabled-hopping',
                externalPort: 32_002,
                internalAddress: '127.0.0.1',
                internalPort: 10_002,
                network: 'udp',
                downloadBytesPerSecond: 0,
                uploadBytesPerSecond: 0,
                enabled: true,
            },
        ],
    });
});
