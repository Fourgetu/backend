import assert from 'node:assert/strict';
import test from 'node:test';

import { MihomoGeneratorService } from '../../src/modules/subscription-template/generators/mihomo.generator.service';
import { SingBoxGeneratorService } from '../../src/modules/subscription-template/generators/singbox.generator.service';
import { ResolveProxyConfigService } from '../../src/modules/subscription-template/resolve-proxy/resolve-proxy-config.service';

const resolver = new ResolveProxyConfigService(
    { getOrThrow: () => 'subscriptions.example.com' } as never,
    {} as never,
);
const applyPortHopping = (
    resolver as unknown as {
        applyUserRoutePortHopping: (
            mask: Record<string, unknown> | null,
            route: unknown,
        ) => Record<string, unknown> | null;
    }
).applyUserRoutePortHopping.bind(resolver);

const baseMask = {
    udp: [{ type: 'salamander', settings: { password: 'obfs-secret' } }],
    quicParams: { brutalDown: 100, congestion: 'bbr' },
};
const route = {
    hostUuid: 'host',
    configProfileInboundUuid: 'inbound',
    externalPort: 32_001,
    network: 'udp',
    nodeUuid: 'node',
    hopStartPort: 20_000,
    hopEndPort: 20_019,
    portHoppingConfig: { enabled: true, hopIntervalSeconds: 30 },
};

const host = (finalMask: Record<string, unknown>) =>
    ({
        finalRemark: 'HY2 user A',
        address: 'edge.example.com',
        port: 32_001,
        protocol: 'hysteria',
        protocolOptions: { version: 2 },
        transport: 'hysteria',
        transportOptions: { version: 2, auth: 'user-password' },
        security: 'tls',
        securityOptions: {
            pinnedPeerCertSha256: null,
            verifyPeerCertByName: null,
            alpn: 'h3',
            enableSessionResumption: false,
            fingerprint: 'chrome',
            serverName: 'edge.example.com',
            echConfigList: null,
            echForceQuery: null,
            echSockopt: null,
            cipherSuites: null,
        },
        streamOverrides: { finalMask, sockopt: null },
        mux: null,
        clientOverrides: {
            shuffleHost: false,
            mihomoX25519: false,
            mihomoIpVersion: null,
            serverDescription: null,
            xrayJsonTemplate: null,
            mapper: { xray: null, mihomo: null, singbox: null },
        },
        metadata: {
            uuid: '00000000-0000-4000-8000-000000000001',
            tags: [],
            excludeFromSubscriptionTypes: [],
            inboundTag: 'hy2',
            configProfileUuid: null,
            configProfileInboundUuid: null,
            isDisabled: false,
            isHidden: false,
            viewPosition: 0,
            remark: 'HY2 user A',
            vlessRouteId: null,
            rawInbound: null,
        },
    }) as never;

test('resolved per-user route overrides a shared HY2 pool with only that user allocation', () => {
    const result = applyPortHopping(baseMask, route) as {
        quicParams: { congestion: string; udpHop: { interval: string; ports: string } };
        udp: unknown[];
    };
    assert.equal(result.quicParams.udpHop.ports, '20000-20019');
    assert.equal(result.quicParams.udpHop.interval, '30s');
    assert.equal(result.quicParams.congestion, 'bbr');
    assert.deepEqual(result.udp, baseMask.udp);
});

test('disabled or absent allocation falls back to canonical externalPort without invalid hopping', () => {
    assert.equal(applyPortHopping(baseMask, null), baseMask);
    const result = applyPortHopping(baseMask, {
        ...route,
        portHoppingConfig: { enabled: false, hopIntervalSeconds: 30 },
    });
    assert.equal(result, baseMask);
});

test('sing-box and Mihomo generators emit their correct per-user hopping fields', () => {
    const finalMask = applyPortHopping(baseMask, route)!;
    const singBox = new SingBoxGeneratorService({} as never);
    const singBoxOutbound = (
        singBox as unknown as { buildHysteria2Outbound: (value: never) => Record<string, unknown> }
    ).buildHysteria2Outbound(host(finalMask));
    assert.equal(singBoxOutbound.server, 'edge.example.com');
    assert.notEqual(singBoxOutbound.server, '127.0.0.1');
    assert.deepEqual(singBoxOutbound.server_ports, ['20000:20019']);
    assert.equal(singBoxOutbound.hop_interval, '30s');
    assert.equal(singBoxOutbound.server_port, 32_001);

    const mihomo = new MihomoGeneratorService({} as never);
    const mihomoNode = (
        mihomo as unknown as {
            buildHysteria2Node: (value: never, extended: boolean) => Record<string, unknown>;
        }
    ).buildHysteria2Node(host(finalMask), false);
    assert.equal(mihomoNode.server, 'edge.example.com');
    assert.notEqual(mihomoNode.server, '127.0.0.1');
    assert.equal(mihomoNode.ports, '20000-20019');
    assert.equal(mihomoNode['hop-interval'], '30s');
    assert.equal(mihomoNode.port, 32_001);
});
