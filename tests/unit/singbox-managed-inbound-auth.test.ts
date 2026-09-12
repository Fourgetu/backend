import assert from 'node:assert/strict';
import test from 'node:test';

import { HashedSet } from '@remnawave/hashed-set';

import { SingBoxConfig } from '../../src/common/helpers/core-config/singbox-config.validator';

const createConfig = () =>
    new SingBoxConfig({
        inbounds: [
            {
                type: 'socks',
                tag: 'managed-socks',
                listen: '127.0.0.1',
                listen_port: 1080,
                users: [],
            },
        ],
        outbounds: [{ type: 'direct', tag: 'direct' }],
    });

test('sing-box managed inbound is removed when no enabled user credentials remain', () => {
    const config = createConfig();
    config.cleanInboundClients();
    config.finalizeInboundClients();

    assert.deepEqual(config.getConfig().inbounds, []);
});

test('sing-box managed inbound remains authenticated after an enabled user is injected', () => {
    const config = createConfig();
    const hashes = new Map<string, HashedSet>();
    config.cleanInboundClients();
    config.includeUserBatch(
        [
            {
                id: 101n,
                vlessUuid: '5a8b1b7a-4983-4e83-b96a-e6cd1f206214',
                trojanPassword: 'trojan-password',
                ssPassword: 'shadowsocks-password',
                socksUsername: 'rw-user',
                socksPassword: 'socks-password',
                tags: ['managed-socks'],
            },
        ],
        hashes,
    );
    config.finalizeInboundClients();

    assert.deepEqual(config.getConfig().inbounds[0]?.users, [
        { username: 'rw-user', password: 'socks-password' },
    ]);
});
