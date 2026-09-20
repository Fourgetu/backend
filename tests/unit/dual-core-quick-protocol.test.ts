import 'reflect-metadata';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import test from 'node:test';

import { HashedSet } from '@remnawave/hashed-set';

import { SingBoxConfig } from '../../src/common/helpers/core-config/singbox-config.validator';
import { resolveInboundAndPublicKey } from '../../src/common/helpers/xray-config/resolve-public-key';
import { getSsPassword } from '../../src/common/helpers/xray-config/ss-cipher';
import { XRayConfig } from '../../src/common/helpers/xray-config/xray-config.validator';
import { getVlessFlowFromDbInbound } from '../../src/common/utils/flow/get-vless-flow';
import { AddUserToNodeHandler } from '../../src/modules/nodes/events/add-user-to-node/add-user-to-node.handler';
import { AddUsersToNodeHandler } from '../../src/modules/nodes/events/add-users-to-node/add-users-to-node.handler';
import { RemoveUserFromNodeHandler } from '../../src/modules/nodes/events/remove-user-from-node/remove-user-from-node.handler';
import { RemoveUsersFromNodeHandler } from '../../src/modules/nodes/events/remove-users-from-node/remove-users-from-node.handler';
import { MihomoGeneratorService } from '../../src/modules/subscription-template/generators/mihomo.generator.service';
import { ResolveProxyConfigService } from '../../src/modules/subscription-template/resolve-proxy/resolve-proxy-config.service';

const aesMethods = ['2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm'] as const;
const ssInbound = (core: string, method: string, password: string) =>
    core === 'xray'
        ? {
              tag: 'ss',
              listen: '127.0.0.1',
              port: 23001,
              protocol: 'shadowsocks',
              settings: { method, password, clients: [], network: 'tcp,udp' },
              streamSettings: { network: 'raw', security: 'none' },
          }
        : {
              tag: 'ss',
              listen: '127.0.0.1',
              listen_port: 23001,
              type: 'shadowsocks',
              method,
              password,
              users: [],
          };
const parser = (core: string, inbound: object) =>
    core === 'xray'
        ? new XRayConfig({ inbounds: [inbound] })
        : new SingBoxConfig({ inbounds: [inbound] });
const user = (id: number, tag: string) => ({
    id: BigInt(id),
    vlessUuid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    trojanPassword: `test-trojan-${id}`,
    ssPassword: String(id).padStart(32, '0'),
    socksUsername: `user-${id}`,
    socksPassword: `test-socks-${id}`,
    tags: [tag],
});

const resolver = new ResolveProxyConfigService(
    { getOrThrow: () => 'sub.example.com' } as never,
    {} as never,
);
const resolve = (
    resolver as unknown as {
        buildResolvedProxyConfig: (ctx: object) => object;
    }
).buildResolvedProxyConfig.bind(resolver);
const generator = new MihomoGeneratorService({} as never);
const toMihomo = (
    generator as unknown as {
        buildProxyNode: (host: object, extended: boolean) => Record<string, unknown>;
    }
).buildProxyNode.bind(generator);

async function subscription(
    inbound: Record<string, unknown>,
    currentUser = user(1, String(inbound.tag)),
) {
    return toMihomo(
        resolve({
            inputHost: {
                uuid: 'host',
                inboundTag: inbound.tag,
                address: 'edge.example.com',
                port: 32001,
                tags: [],
                excludeFromSubscriptionTypes: [],
                vlessRouteId: null,
                sni: null,
                fingerprint: null,
                securityLayer: 'DEFAULT',
                mapper: { mihomo: null, singbox: null, xray: null },
                rawInbound: inbound,
            },
            inbound,
            finalRemark: 'test',
            user: currentUser,
            userRoute: null,
            publicKeyMap: await resolveInboundAndPublicKey([inbound]),
            mldsa65PublicKeyMap: new Map(),
            encryptionMap: new Map(),
        }),
        false,
    );
}

for (const core of ['xray', 'singbox']) {
    for (const method of aesMethods) {
        const size = method === aesMethods[0] ? 16 : 32;
        test(`${core} ${method}: managed validation accepts only correctly sized server keys`, () => {
            assert.doesNotThrow(() =>
                parser(core, ssInbound(core, method, randomBytes(size).toString('base64'))),
            );
            assert.throws(
                () =>
                    parser(
                        core,
                        ssInbound(
                            core,
                            method,
                            randomBytes(size === 16 ? 32 : 16).toString('base64'),
                        ),
                    ),
                /base64/,
            );
        });
        test(`${core} ${method}: independent users, enabled snapshot reconciliation and subscription password`, async () => {
            const serverPassword = randomBytes(size).toString('base64');
            const inbound = ssInbound(core, method, serverPassword);
            const config = parser(core, inbound);
            config.cleanInboundClients(true);
            config.includeUserBatch([user(1, 'ss'), user(2, 'ss')], new Map<string, HashedSet>());
            const raw = config.getConfig().inbounds![0] as Record<string, unknown>;
            const clients = (
                core === 'xray'
                    ? (raw.settings as { clients: { password: string }[] }).clients
                    : raw.users
            ) as { password: string }[];
            assert.equal(clients.length, 2);
            assert.notEqual(clients[0].password, clients[1].password);
            assert.equal(Buffer.from(clients[0].password, 'base64').length, size);
            assert.equal(
                clients[0].password,
                getSsPassword(user(1, 'ss').ssPassword, true, method),
            );
            const output = await subscription(inbound);
            assert.equal(output.type, 'ss');
            assert.equal(output.cipher, method);
            assert.equal(output.password, `${serverPassword}:${clients[0].password}`);
            assert.equal(output.server, 'edge.example.com');
            assert.equal(output.port, 32001);
            assert.equal(output.udp, true);
            config.cleanInboundClients(true);
            config.includeUserBatch([user(2, 'ss')], new Map<string, HashedSet>());
            const after = config.getConfig().inbounds![0] as Record<string, unknown>;
            assert.equal(
                (core === 'xray'
                    ? (after.settings as { clients: unknown[] }).clients
                    : (after.users as unknown[])
                ).length,
                1,
            );
            config.cleanInboundClients(true);
            config.finalizeInboundClients();
            assert.equal(config.getConfig().inbounds!.length, 0);
        });
    }
    test(`${core}: ChaCha20 Managed Users is rejected (never downgrades)`, () => {
        assert.throws(
            () =>
                parser(
                    core,
                    ssInbound(
                        core,
                        '2022-blake3-chacha20-poly1305',
                        randomBytes(32).toString('base64'),
                    ),
                ),
            /ChaCha20 Managed Users/,
        );
    });

    test(`${core} Reality: managed Vision flow and standard Mihomo public subscription`, async () => {
        const keys = generateKeyPairSync('x25519');
        const privateKey = keys.privateKey.export({ format: 'jwk' }).d!;
        const publicKey = keys.publicKey.export({ format: 'jwk' }).x!;
        const inbound =
            core === 'xray'
                ? {
                      protocol: 'vless',
                      tag: 'vision',
                      listen: '127.0.0.1',
                      port: 23456,
                      settings: { decryption: 'none', clients: [], flow: 'xtls-rprx-vision' },
                      streamSettings: {
                          network: 'raw',
                          security: 'reality',
                          realitySettings: {
                              privateKey,
                              target: 'example.com:443',
                              serverNames: ['example.com'],
                              shortIds: ['0123456789abcdef'],
                              minClientVer: '1.8.1',
                          },
                      },
                  }
                : {
                      type: 'vless',
                      tag: 'vision',
                      listen: '127.0.0.1',
                      listen_port: 23456,
                      users: [],
                      tls: {
                          enabled: true,
                          server_name: 'example.com',
                          reality: {
                              enabled: true,
                              private_key: privateKey,
                              short_id: ['0123456789abcdef'],
                              handshake: { server: 'example.com', server_port: 443 },
                          },
                      },
                  };
        const config = parser(core, inbound);
        config.cleanInboundClients(true);
        config.includeUserBatch([user(1, 'vision')], new Map<string, HashedSet>());
        const raw = config.getConfig().inbounds![0] as Record<string, unknown>;
        const clients = (
            core === 'xray' ? (raw.settings as { clients: object[] }).clients : raw.users
        ) as { flow: string }[];
        assert.equal(
            core === 'xray' ? (raw.settings as { flow: string }).flow : clients[0].flow,
            'xtls-rprx-vision',
        );
        assert.equal(
            getVlessFlowFromDbInbound({ type: 'vless', rawInbound: inbound } as never),
            'xtls-rprx-vision',
        );
        const output = await subscription(inbound);
        assert.equal(output.type, 'vless');
        assert.equal(output.flow, 'xtls-rprx-vision');
        assert.equal(output.tls, true);
        assert.equal(output.servername, 'example.com');
        assert.deepEqual(output['reality-opts'], {
            'public-key': publicKey,
            'short-id': '0123456789abcdef',
        });
        assert.equal(JSON.stringify(output).includes(privateKey), false);
        assert.equal(JSON.stringify(output).includes('127.0.0.1'), false);
        assert.equal(JSON.stringify(output).includes('minClientVer'), false);
    });
}

test('AES-256 keeps the established per-user encoding for existing subscriptions', () => {
    const password = user(1, 'ss').ssPassword;
    assert.equal(
        getSsPassword(password, true, aesMethods[1]),
        Buffer.from(password).toString('base64'),
    );
});

test('traditional sing-box Shadowsocks cannot silently downgrade Managed Users into shared credentials', () => {
    assert.throws(
        () => parser('singbox', ssInbound('singbox', 'aes-128-gcm', 'test-shared-password')),
        /Managed Users requires SS2022/,
    );
    assert.doesNotThrow(() => parser('xray', ssInbound('xray', 'aes-128-gcm', 'test-password')));
});

test('custom short/UTF-8 user passwords produce valid method-specific keys without sharing a server key', () => {
    for (const method of aesMethods) {
        for (const password of ['short-test-password', '测试密码-test']) {
            const key = getSsPassword(password, true, method);
            assert.equal(Buffer.from(key, 'base64').length, method === aesMethods[0] ? 16 : 32);
            assert.equal(key, getSsPassword(password, true, method));
            assert.notEqual(key, getSsPassword(`${password}-other`, true, method));
        }
    }
});

test('SS2022 TCP+UDP route is selected for subscriptions and keeps the public GOST port', async () => {
    const inbound = ssInbound('singbox', aesMethods[0], randomBytes(16).toString('base64'));
    const inputHost = {
        uuid: 'host',
        configProfileInboundUuid: 'ib',
        rawInbound: inbound,
        address: 'edge.example.com',
        port: 23001,
        vlessRouteId: null,
        tags: [],
        mapper: {},
    };
    const route = {
        hostUuid: 'host',
        configProfileInboundUuid: 'ib',
        externalPort: 32001,
        network: 'tcp,udp',
        hopStartPort: null,
        hopEndPort: null,
        portHoppingConfig: null,
    };
    const selected = (
        resolver as unknown as { resolveUserRoute: (host: object, routes: object[]) => object }
    ).resolveUserRoute(inputHost, [route]);
    assert.equal(selected, route);
    const output = toMihomo(
        resolve({
            inputHost,
            inbound,
            user: user(1, 'ss'),
            userRoute: selected,
            finalRemark: 'SS2022',
            publicKeyMap: new Map(),
            encryptionMap: new Map(),
            mldsa65PublicKeyMap: new Map(),
        }),
        false,
    );
    assert.equal(output.port, 32001);
    assert.equal(output.udp, true);
    const legacy = { ...route, network: 'tcp' };
    const legacyOutput = toMihomo(
        resolve({
            inputHost,
            inbound,
            user: user(1, 'ss'),
            userRoute: legacy,
            finalRemark: 'legacy TCP route',
            publicKeyMap: new Map(),
            encryptionMap: new Map(),
            mldsa65PublicKeyMap: new Map(),
        }),
        false,
    );
    assert.equal(legacyOutput.port, 32001);
    assert.equal(legacyOutput.udp, false);
});

test('single-user SS2022 updates reconcile templates so zero-user listeners can be safely restored', async () => {
    const inbounds = ['xray', 'singbox'].flatMap((core) =>
        aesMethods.map((method) => ({
            tag: `${core}-${method}`,
            type: 'shadowsocks',
            rawInbound: ssInbound(
                core,
                method,
                randomBytes(method === aesMethods[0] ? 16 : 32).toString('base64'),
            ),
        })),
    );
    const sent: { data: { data: { tag: string; password: string; type: string }[] } }[] = [];
    const started: unknown[] = [];
    const handler = new AddUserToNodeHandler(
        {
            findConnectedNodes: async () => [
                {
                    uuid: 'node',
                    activeInbounds: inbounds,
                    activeConfigProfileUuid: 'xray',
                    activeSingBoxConfigProfileUuid: 'sb',
                },
            ],
        } as never,
        {
            addUserToNode: async (data: never) => sent.push(data),
            startNode: async (data: unknown) => started.push(data),
        } as never,
        {
            execute: async () => ({ isOk: true, response: { ...user(1, 'ss'), inbounds } }),
        } as never,
    );
    await handler.handle({ userId: 1n });
    assert.equal(sent.length, 0);
    assert.deepEqual(started, [{ nodeUuid: 'node' }]);
});

test('single and bulk disable/delete reconcile SS2022 instead of leaving a shared-password empty listener', async () => {
    const started: unknown[] = [];
    const removed: unknown[] = [];
    const repository = {
        findConnectedNodes: async () => [
            {
                uuid: 'node',
                activeInbounds: [
                    {
                        type: 'shadowsocks',
                        rawInbound: ssInbound(
                            'singbox',
                            aesMethods[0],
                            randomBytes(16).toString('base64'),
                        ),
                    },
                ],
            },
        ],
    };
    const queues = {
        startNode: async (data: unknown) => started.push(data),
        removeUserFromNodeBulk: async (data: unknown[]) => removed.push(...data),
        removeUsersFromNode: async (data: unknown) => removed.push(data),
    };
    await new RemoveUserFromNodeHandler(repository as never, queues as never).handle({
        id: 1n,
        vlessUuid: user(1, 'ss').vlessUuid,
    });
    await new RemoveUsersFromNodeHandler(repository as never, queues as never).handle({
        users: [{ id: 1n, vlessUuid: user(1, 'ss').vlessUuid }],
    });
    assert.deepEqual(started, [{ nodeUuid: 'node' }, { nodeUuid: 'node' }]);
    assert.deepEqual(removed, []);
});

test('bulk SS2022 updates reconcile authoritative enabled users instead of sending ambiguous raw passwords', async () => {
    const started: unknown[] = [];
    let batchCalls = 0;
    const handler = new AddUsersToNodeHandler(
        {
            findConnectedNodes: async () => [
                {
                    uuid: 'node',
                    activeConfigProfileUuid: 'xray',
                    activeSingBoxConfigProfileUuid: 'sb',
                    activeInbounds: [
                        {
                            type: 'shadowsocks',
                            tag: 'ss',
                            rawInbound: ssInbound(
                                'singbox',
                                aesMethods[0],
                                randomBytes(16).toString('base64'),
                            ),
                        },
                    ],
                },
            ],
        } as never,
        {
            startNode: async (data: unknown) => started.push(data),
            addUsersToNode: async () => batchCalls++,
        } as never,
        {
            execute: async () => ({ isOk: true, response: [user(1, 'ss'), user(2, 'ss')] }),
        } as never,
    );
    await handler.handle({ ids: [1n, 2n] });
    assert.deepEqual(started, [{ nodeUuid: 'node' }]);
    assert.equal(batchCalls, 0);
});
