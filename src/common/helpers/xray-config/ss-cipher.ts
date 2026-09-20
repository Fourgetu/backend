import { createHash } from 'node:crypto';

import { CipherType } from '@remnawave/node-contract';

export enum ShadowsocksMethod {
    AES_128_GCM = 'aes-128-gcm',
    AES_256_GCM = 'aes-256-gcm',
    CHACHA20_IETF_POLY1305 = 'chacha20-ietf-poly1305',
    SS2022_BLAKE3_AES_256_GCM = '2022-blake3-aes-256-gcm',
    SS2022_BLAKE3_AES_128_GCM = '2022-blake3-aes-128-gcm',
}

export const SHADOWSOCKS_METHODS = [
    ShadowsocksMethod.AES_128_GCM,
    ShadowsocksMethod.AES_256_GCM,
    ShadowsocksMethod.CHACHA20_IETF_POLY1305,
    ShadowsocksMethod.SS2022_BLAKE3_AES_256_GCM,
    ShadowsocksMethod.SS2022_BLAKE3_AES_128_GCM,
];

type RawInbound = {
    settings?: {
        method?: string;
        [key: string]: any;
    };
    [key: string]: any;
} | null;

export function getMethodFromRawInbound(rawInbound: RawInbound): string | undefined {
    return rawInbound?.type === 'shadowsocks' ? rawInbound.method : rawInbound?.settings?.method;
}

export function getCipherTypeFromString(rawInbound: RawInbound): CipherType {
    const method = getMethodFromRawInbound(rawInbound);
    switch (method) {
        case ShadowsocksMethod.CHACHA20_IETF_POLY1305:
            return CipherType.CHACHA20_POLY1305;
        case ShadowsocksMethod.AES_128_GCM:
            return CipherType.AES_128_GCM;
        case ShadowsocksMethod.AES_256_GCM:
            return CipherType.AES_256_GCM;
        default:
            return CipherType.CHACHA20_POLY1305;
    }
}

export function isSS2022Method(rawInbound: RawInbound): boolean {
    return isSS2022MethodFromMethod(getMethodFromRawInbound(rawInbound));
}

export function isSS2022MethodFromMethod(method: string | undefined): boolean {
    if (!method) {
        return false;
    }
    return (
        method === ShadowsocksMethod.SS2022_BLAKE3_AES_256_GCM ||
        method === ShadowsocksMethod.SS2022_BLAKE3_AES_128_GCM
    );
}

export function getDecodedKeySize(password: string): number {
    try {
        return Buffer.from(password, 'base64').length;
    } catch {
        return 0;
    }
}

export function encodeSS2022Password(password: string): string {
    return Buffer.from(password).toString('base64');
}

export function getSsPassword(password: string, isSS2022: boolean, method?: string): string {
    if (isSS2022 && method === ShadowsocksMethod.SS2022_BLAKE3_AES_128_GCM) {
        return createHash('sha256')
            .update('remnawave:ss2022:aes128:')
            .update(password)
            .digest()
            .subarray(0, 16)
            .toString('base64');
    }
    // Existing 32-byte AES-256 credentials remain byte-identical. User APIs also
    // allow shorter/custom UTF-8 passwords; derive a valid key for those rather
    // than handing a malformed-length key to either core.
    if (isSS2022 && Buffer.byteLength(password, 'utf8') !== 32) {
        return createHash('sha256')
            .update('remnawave:ss2022:aes256:')
            .update(password)
            .digest()
            .toString('base64');
    }
    return isSS2022 ? encodeSS2022Password(password) : password;
}

export function validateManagedShadowsocks(method: string | undefined, password: unknown): void {
    if (method === '2022-blake3-chacha20-poly1305') {
        throw new Error(
            'Xray 26.7.28 / sing-box 1.13.14 do not support SS2022 ChaCha20 Managed Users.',
        );
    }
    if (!isSS2022MethodFromMethod(method)) return;
    const size = method === ShadowsocksMethod.SS2022_BLAKE3_AES_128_GCM ? 16 : 32;
    if (
        typeof password !== 'string' ||
        Buffer.from(password, 'base64').length !== size ||
        Buffer.from(password, 'base64').toString('base64') !== password
    ) {
        throw new Error(
            `SS2022 server password must be canonical base64 encoding of ${size} bytes.`,
        );
    }
}
