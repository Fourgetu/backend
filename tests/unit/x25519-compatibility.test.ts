import assert from 'node:assert/strict';
import test from 'node:test';

import {
    generateEncryptionFromDecryption,
    generateX25519PublicKey,
} from '../../src/common/helpers/vless-encryption/generate-encryption-from-decryption';
import {
    resolveEncryptionFromDecryption,
    resolveInboundAndPublicKey,
} from '../../src/common/helpers/xray-config/resolve-public-key';

// Public RFC 7748 test vector, not a deployed credential.
const privateKey = Buffer.from(
    '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
    'hex',
);
const publicKey = Buffer.from(
    '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
    'hex',
).toString('base64url');

test('X25519 matches RFC 7748 for padded base64 and base64url inputs', async () => {
    for (const encoding of ['base64', 'base64url'] as const) {
        assert.equal(await generateX25519PublicKey(privateKey.toString(encoding)), publicKey);
    }
});

test('both REALITY core formats resolve and retain cached public keys', async () => {
    const inbounds = [
        {
            tag: 'xray',
            streamSettings: { realitySettings: { privateKey: privateKey.toString('base64') } },
        },
        {
            tag: 'singbox',
            type: 'vless',
            tls: { reality: { private_key: privateKey.toString('base64url') } },
        },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
        assert.deepEqual(
            await resolveInboundAndPublicKey(inbounds),
            new Map([
                ['xray', publicKey],
                ['singbox', publicKey],
            ]),
        );
    }
});

test('malformed key lengths are rejected without aborting other inbound resolution', async () => {
    for (const length of [0, 1, 31, 33, 64]) {
        await assert.rejects(
            generateX25519PublicKey(Buffer.alloc(length).toString('base64')),
            /Expected 32 bytes/,
        );
    }
    const result = await resolveInboundAndPublicKey([
        { tag: 'bad', streamSettings: { realitySettings: { privateKey: 'bad' } } },
        { tag: 'missing' },
        {
            tag: 'valid',
            type: 'vless',
            tls: { reality: { private_key: privateKey.toString('base64url') } },
        },
    ]);
    assert.deepEqual(result, new Map([['valid', publicKey]]));
});

test('VLESS encryption derives the same public key and preserves ticket mode', async () => {
    for (const [ticket, rtt] of [
        ['0s', '1rtt'],
        ['600s', '0rtt'],
    ]) {
        const decryption = `mlkem768x25519plus.native.${ticket}.${privateKey.toString('base64url')}`;
        const expected = `mlkem768x25519plus.native.${rtt}.${publicKey}`;
        assert.equal((await generateEncryptionFromDecryption(decryption)).encryption, expected);
        assert.equal(
            (
                await resolveEncryptionFromDecryption([
                    { tag: 'vless', protocol: 'vless', settings: { decryption } },
                ])
            ).get('vless'),
            expected,
        );
    }
});
