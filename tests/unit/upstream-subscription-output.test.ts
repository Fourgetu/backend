import assert from 'node:assert/strict';
import test from 'node:test';

import { XrayJsonGeneratorService } from '../../src/modules/subscription-template/generators/xray-json.generator.service';
import { USERS_JOB_NAMES } from '../../src/queue/_users/constants';
import { SubscriptionRequestsQueueProcessor } from '../../src/queue/_users/processors/subscription-requests.processor';

test('serialized gRPC subscription preserves multiMode and the custom external endpoint', async () => {
    const generator = new XrayJsonGeneratorService({
        getCachedTemplateByType: async () => ({ outbounds: [] }),
    } as never);

    for (const multiMode of [true, false, undefined]) {
        const output = await generator.generateConfig({
            isExtendedClient: false,
            hosts: [
                {
                    finalRemark: 'gRPC external route',
                    address: 'edge.example.com',
                    port: 32001,
                    protocol: 'vless',
                    protocolOptions: { id: '00000000-0000-4000-8000-000000000001' },
                    transport: 'grpc',
                    transportOptions: {
                        serviceName: 'proxy-service',
                        authority: 'edge.example.com',
                        multiMode,
                    },
                    security: 'none',
                    streamOverrides: { sockopt: null, finalMask: null },
                    mux: null,
                    clientOverrides: { mapper: { xrayJson: null }, xrayJsonTemplate: null },
                    metadata: { isHidden: false, excludeFromSubscriptionTypes: [] },
                } as never,
            ],
        });
        const configs = JSON.parse(output);
        assert.equal(configs.length, 1);
        const outbound = configs[0].outbounds[0];
        assert.deepEqual(outbound.streamSettings.grpcSettings, {
            serviceName: 'proxy-service',
            authority: 'edge.example.com',
            multiMode: multiMode ?? false,
        });
        assert.equal(outbound.settings.vnext[0].address, 'edge.example.com');
        assert.equal(outbound.settings.vnext[0].port, 32001);
    }
});

test('subscription job exports the documented response-type field and lossless user ID', async () => {
    const exported: Record<string, string>[] = [];
    const config: Record<string, boolean | number> = {
        EXPORT_TO_STREAM_ENABLED: true,
        EXPORT_TO_STREAM_MAXLEN: 1000,
        SERVICE_DISABLE_SRH_RECORDS: true,
    };
    const processor = new SubscriptionRequestsQueueProcessor(
        {
            execute: async () => assert.fail('database history is disabled in this fixture'),
        } as never,
        {
            getOrThrow: (key: string) => config[key],
        } as never,
        {
            xaddTrimmed: async (_key: string, _maxLength: number, fields: Record<string, string>) =>
                exported.push(fields),
        } as never,
    );

    await processor.process({
        name: USERS_JOB_NAMES.ADD_SUBSCRIPTION_REQUEST_RECORD,
        data: {
            userId: '9007199254740993',
            srrResponseType: 'XRAY_JSON',
            requestAt: new Date('2026-10-13T00:00:00Z'),
            requestIp: '192.0.2.1',
            userAgent: 'test-client',
            srrRuleName: 'test-rule',
        },
    } as never);

    assert.equal(exported.length, 1);
    assert.equal(exported[0].srrResponseType, 'XRAY_JSON');
    assert.equal(Object.hasOwn(exported[0], 'ssrResponseType'), false);
    assert.equal(exported[0].userId, '9007199254740993');
    assert.equal(exported[0].requestAt, '2026-10-13T00:00:00.000Z');
    assert.equal(exported[0].srrRuleName, 'test-rule');
});
