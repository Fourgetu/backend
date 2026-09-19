import { createHash, createPublicKey, timingSafeEqual, X509Certificate } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import { Injectable } from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config';

import {
    hasPartialPanelCertificatePair,
    isPanelCertificatePair,
    PANEL_CERTIFICATE_ID,
} from './managed-certificate.constants';

export type TCertificateProfileStatus = 'expired' | 'invalid' | 'ready' | 'unconfigured';

export interface ICertificateProfileMetadata {
    id: string;
    source: 'panel-reverse-proxy';
    primaryDomain: null | string;
    sans: string[];
    fingerprint: null | string;
    notAfter: null | string;
    updatedAt: null | string;
    status: TCertificateProfileStatus;
    statusMessage: null | string;
}

export interface ICertificateSyncBundle {
    id: string;
    hash: string;
    certificate: string;
    privateKey: string;
}

type TJsonRecord = Record<string, unknown>;

const normalizeHostname = (value: string): string => value.trim().toLowerCase().replace(/\.$/, '');

export const certificateNameMatches = (hostname: string, names: readonly string[]): boolean => {
    const normalizedHostname = normalizeHostname(hostname);
    if (!normalizedHostname) return false;

    return names.some((name) => {
        const normalizedName = normalizeHostname(name);
        if (!normalizedName.includes('*')) return normalizedName === normalizedHostname;
        if (!normalizedName.startsWith('*.') || normalizedName.slice(2).includes('*')) return false;

        const suffix = normalizedName.slice(1);
        if (!normalizedHostname.endsWith(suffix)) return false;
        return normalizedHostname.split('.').length === normalizedName.split('.').length;
    });
};

const parseSubjectAlternativeNames = (certificate: X509Certificate): string[] => {
    if (!certificate.subjectAltName) return [];

    return certificate.subjectAltName
        .split(/,\s*/)
        .flatMap((entry) => {
            const match = /^DNS:(.+)$/i.exec(entry);
            return match ? [normalizeHostname(match[1].replace(/^"|"$/g, ''))] : [];
        })
        .filter(Boolean);
};

const parseCommonName = (certificate: X509Certificate): null | string => {
    const match = /(?:^|\n)CN\s*=\s*([^\n]+)/i.exec(certificate.subject);
    return match ? normalizeHostname(match[1]) : null;
};

const certificateNames = (certificate: X509Certificate): string[] => {
    const sans = parseSubjectAlternativeNames(certificate);
    if (sans.length > 0) return sans;
    const commonName = parseCommonName(certificate);
    return commonName ? [commonName] : [];
};

const publicKeyDer = (key: ReturnType<typeof createPublicKey>): Buffer =>
    key.export({ type: 'spki', format: 'der' }) as Buffer;

const assertCertificateKeyPair = (certificate: X509Certificate, privateKey: string): void => {
    const certificatePublicKey = publicKeyDer(certificate.publicKey);
    const privateKeyPublicKey = publicKeyDer(createPublicKey(privateKey));
    if (
        certificatePublicKey.length !== privateKeyPublicKey.length ||
        !timingSafeEqual(certificatePublicKey, privateKeyPublicKey)
    ) {
        throw new Error('The configured TLS certificate and private key do not match.');
    }
};

const collectManagedServerNames = (config: TJsonRecord): string[] => {
    if (!Array.isArray(config.inbounds)) return [];
    const names = new Set<string>();

    for (const candidate of config.inbounds) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const inbound = candidate as TJsonRecord;
        const tls = inbound.tls;
        if (!tls || typeof tls !== 'object' || Array.isArray(tls)) continue;
        const tlsRecord = tls as TJsonRecord;
        if (!isPanelCertificatePair(tlsRecord.certificate_path, tlsRecord.key_path)) continue;
        if (typeof tlsRecord.server_name === 'string' && tlsRecord.server_name.trim()) {
            names.add(normalizeHostname(tlsRecord.server_name));
        }
    }

    return [...names];
};

export const configRequiresPanelCertificate = (config: TJsonRecord): boolean => {
    if (!Array.isArray(config.inbounds)) return false;

    for (const candidate of config.inbounds) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const tls = (candidate as TJsonRecord).tls;
        if (!tls || typeof tls !== 'object' || Array.isArray(tls)) continue;
        const tlsRecord = tls as TJsonRecord;
        if (hasPartialPanelCertificatePair(tlsRecord.certificate_path, tlsRecord.key_path)) {
            if (!isPanelCertificatePair(tlsRecord.certificate_path, tlsRecord.key_path)) {
                throw new Error(
                    'Managed TLS certificate and private-key markers must be used together.',
                );
            }
            return true;
        }
    }

    return false;
};

@Injectable()
export class CertificateProfileService {
    constructor(private readonly configService: TypedConfigService) {}

    public async getPublicMetadata(): Promise<ICertificateProfileMetadata> {
        try {
            const profile = await this.loadProfile();
            return profile.metadata;
        } catch (error) {
            const statusMessage =
                error instanceof Error ? error.message : 'Invalid TLS certificate.';
            const unconfigured = statusMessage === 'Panel TLS certificate is not configured.';
            return {
                id: PANEL_CERTIFICATE_ID,
                source: 'panel-reverse-proxy',
                primaryDomain: null,
                sans: [],
                fingerprint: null,
                notAfter: null,
                updatedAt: null,
                status: unconfigured ? 'unconfigured' : 'invalid',
                statusMessage,
            };
        }
    }

    public async getBundleForConfig(config: TJsonRecord): Promise<ICertificateSyncBundle[]> {
        if (!configRequiresPanelCertificate(config)) return [];

        const profile = await this.loadProfile();
        if (profile.metadata.status !== 'ready') {
            throw new Error('Panel TLS certificate is unavailable or expired.');
        }

        const requestedServerNames = collectManagedServerNames(config);
        const validNames = profile.metadata.sans.length
            ? profile.metadata.sans
            : profile.metadata.primaryDomain
              ? [profile.metadata.primaryDomain]
              : [];
        for (const serverName of requestedServerNames) {
            if (!certificateNameMatches(serverName, validNames)) {
                throw new Error(
                    `TLS server name "${serverName}" is not covered by the panel certificate.`,
                );
            }
        }

        return [profile.bundle];
    }

    private async loadProfile(): Promise<{
        metadata: ICertificateProfileMetadata;
        bundle: ICertificateSyncBundle;
    }> {
        const certificatePath = this.configService.getOrThrow('PANEL_CERTIFICATE_PATH');
        const privateKeyPath = this.configService.getOrThrow('PANEL_PRIVATE_KEY_PATH');

        let certificate: string;
        let privateKey: string;
        let certificateStat: Awaited<ReturnType<typeof stat>>;
        let privateKeyStat: Awaited<ReturnType<typeof stat>>;
        try {
            [certificate, privateKey, certificateStat, privateKeyStat] = await Promise.all([
                readFile(certificatePath, 'utf8'),
                readFile(privateKeyPath, 'utf8'),
                stat(certificatePath),
                stat(privateKeyPath),
            ]);
        } catch {
            throw new Error('Panel TLS certificate is not configured.');
        }

        let parsed: X509Certificate;
        try {
            parsed = new X509Certificate(certificate);
            assertCertificateKeyPair(parsed, privateKey);
        } catch {
            throw new Error('Panel TLS certificate or private key is invalid.');
        }

        const notAfter = new Date(parsed.validTo);
        if (!Number.isFinite(notAfter.getTime()) || notAfter.getTime() <= Date.now()) {
            throw new Error('Panel TLS certificate is expired.');
        }

        const names = certificateNames(parsed);
        const sans = parseSubjectAlternativeNames(parsed);
        const updatedAt = new Date(
            Math.max(certificateStat.mtimeMs, privateKeyStat.mtimeMs),
        ).toISOString();
        const hash = createHash('sha256')
            .update(certificate)
            .update('\0')
            .update(privateKey)
            .digest('hex');

        return {
            metadata: {
                id: PANEL_CERTIFICATE_ID,
                source: 'panel-reverse-proxy',
                primaryDomain: names[0] ?? null,
                sans,
                fingerprint: parsed.fingerprint256.replaceAll(':', '').toLowerCase(),
                notAfter: notAfter.toISOString(),
                updatedAt,
                status: 'ready',
                statusMessage: null,
            },
            bundle: {
                id: PANEL_CERTIFICATE_ID,
                hash,
                certificate,
                privateKey,
            },
        };
    }
}
