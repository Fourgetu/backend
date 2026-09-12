import { hasher } from 'node-object-hash';
import { readFileSync } from 'node:fs';

import { HashedSet } from '@remnawave/hashed-set';

import { UserForConfigEntity } from '@modules/users/entities/users-for-config';

import { getSsPassword, isSS2022MethodFromMethod } from '../xray-config/ss-cipher';
import { ICoreConfig, ICoreConfigInbound } from './core-config.interface';

const MANAGED_CLIENT_PROTOCOLS = new Set([
    'anytls',
    'hysteria2',
    'shadowsocks',
    'socks',
    'trojan',
    'vless',
]);

type TJsonRecord = Record<string, unknown>;

interface ISingBoxInbound extends TJsonRecord {
    type: string;
    tag: string;
    listen_port?: number;
    network?: string | string[];
    transport?: { type?: string };
    tls?: {
        enabled?: boolean;
        certificate?: string | string[];
        certificate_path?: string;
        key?: string | string[];
        key_path?: string;
    };
    method?: string;
    users?: TJsonRecord[];
}

interface ISingBoxConfig extends TJsonRecord {
    inbounds: ISingBoxInbound[];
    outbounds?: TJsonRecord[];
    route?: { rules?: TJsonRecord[]; rule_set?: TJsonRecord[] };
}

export class SingBoxConfig implements ICoreConfig {
    private config: ISingBoxConfig;
    private inboundsByTag = new Map<string, ISingBoxInbound>();

    constructor(configInput: object | Record<string, unknown> | string) {
        this.config = this.parseConfig(configInput);
        this.validate();
        this.indexInbounds();
    }

    public getConfig(): ISingBoxConfig {
        return this.config;
    }

    public getSortedConfig(): ISingBoxConfig {
        return this.sortObject(this.config) as ISingBoxConfig;
    }

    public getConfigHash(): string {
        return hasher({ trim: true, sort: false }).hash(this.getSortedConfig());
    }

    public getAllInbounds(): ICoreConfigInbound[] {
        return this.config.inbounds
            .filter((inbound) => MANAGED_CLIENT_PROTOCOLS.has(inbound.type))
            .map((inbound) => ({
                tag: inbound.tag,
                rawInbound: inbound,
                type: inbound.type,
                network: this.getNetwork(inbound),
                security: inbound.tls?.enabled ? 'tls' : null,
                port: Number.isInteger(inbound.listen_port) ? inbound.listen_port! : null,
            }));
    }

    public cleanInboundClients(): void {
        for (const inbound of this.config.inbounds) {
            if (MANAGED_CLIENT_PROTOCOLS.has(inbound.type)) inbound.users = [];
        }
    }

    public processCertificates(): ISingBoxConfig {
        for (const inbound of this.config.inbounds) {
            if (!inbound.tls) continue;
            if (inbound.tls.certificate_path) {
                try {
                    inbound.tls.certificate = this.readPemLines(inbound.tls.certificate_path);
                    delete inbound.tls.certificate_path;
                } catch {
                    // A node-local certificate path does not exist on the panel by design.
                }
            }
            if (inbound.tls.key_path) {
                try {
                    inbound.tls.key = this.readPemLines(inbound.tls.key_path);
                    delete inbound.tls.key_path;
                } catch {
                    // A node-local private key path does not exist on the panel by design.
                }
            }
        }
        return this.config;
    }

    public replaceSnippets(snippets: Map<string, unknown>): void {
        this.replaceSnippetsInArray(this.config.outbounds, snippets);
        this.replaceSnippetsInArray(this.config.route?.rules, snippets);
        this.replaceSnippetsInArray(this.config.route?.rule_set, snippets);
    }

    public leaveInbounds(tags: Set<string>): void {
        this.config.inbounds = this.config.inbounds.filter(
            (inbound) => tags.has(inbound.tag) || !MANAGED_CLIENT_PROTOCOLS.has(inbound.type),
        );
        this.indexInbounds();
    }

    public includeUserBatch(
        users: UserForConfigEntity[],
        inboundsUserSets: Map<string, HashedSet>,
    ): ISingBoxConfig {
        for (const user of users) {
            for (const tag of user.tags) {
                const inbound = this.inboundsByTag.get(tag);
                if (!inbound || !MANAGED_CLIENT_PROTOCOLS.has(inbound.type)) continue;

                inbound.users ??= [];
                inbound.users.push(this.toSingBoxUser(inbound, user));
                if (!inboundsUserSets.has(tag)) inboundsUserSets.set(tag, new HashedSet());
                inboundsUserSets.get(tag)!.add(user.vlessUuid);
            }
        }
        return this.config;
    }

    public finalizeInboundClients(): void {
        this.config.inbounds = this.config.inbounds.filter(
            (inbound) =>
                !MANAGED_CLIENT_PROTOCOLS.has(inbound.type) ||
                (Array.isArray(inbound.users) && inbound.users.length > 0),
        );
        this.indexInbounds();
    }

    public fixIncorrectServerNames(): void {}

    private toSingBoxUser(inbound: ISingBoxInbound, user: UserForConfigEntity): TJsonRecord {
        const name = user.id.toString();

        switch (inbound.type) {
            case 'anytls':
            case 'hysteria2':
                return { name, password: user.vlessUuid };
            case 'socks':
                return { username: user.socksUsername, password: user.socksPassword };
            case 'vless':
                return { name, uuid: user.vlessUuid };
            case 'trojan':
                return { name, password: user.trojanPassword };
            case 'shadowsocks':
                return {
                    name,
                    password: getSsPassword(
                        user.ssPassword,
                        isSS2022MethodFromMethod(inbound.method),
                    ),
                };
            default:
                throw new Error(`Protocol ${inbound.type} is not supported.`);
        }
    }

    private parseConfig(input: object | Record<string, unknown> | string): ISingBoxConfig {
        let parsed: unknown = input;
        if (typeof input === 'string') {
            try {
                parsed = JSON.parse(input);
            } catch (error) {
                throw new Error(`Invalid JSON input: ${error}`);
            }
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Invalid sing-box configuration format.');
        }
        return parsed as ISingBoxConfig;
    }

    private validate(): void {
        if (!Array.isArray(this.config.inbounds) || this.config.inbounds.length === 0) {
            throw new Error("Config doesn't have inbounds.");
        }

        const tags = new Set<string>();
        for (const inbound of this.config.inbounds) {
            if (!inbound || typeof inbound !== 'object') {
                throw new Error('Every sing-box inbound must be an object.');
            }
            if (typeof inbound.type !== 'string' || !inbound.type) {
                throw new Error('Every sing-box inbound must have a type.');
            }
            if (typeof inbound.tag !== 'string' || !inbound.tag || tags.has(inbound.tag)) {
                throw new Error('Every sing-box inbound must have a unique tag.');
            }
            if (inbound.tag.includes(','))
                throw new Error("Character ',' is not allowed in inbound tag.");
            if (
                inbound.listen_port !== undefined &&
                (!Number.isInteger(inbound.listen_port) ||
                    inbound.listen_port < 1 ||
                    inbound.listen_port > 65_535)
            ) {
                throw new Error(`Invalid listen_port in inbound "${inbound.tag}".`);
            }
            if (
                (inbound.type === 'anytls' || inbound.type === 'hysteria2') &&
                !inbound.tls?.enabled
            ) {
                throw new Error(`${inbound.type} inbound "${inbound.tag}" requires tls.enabled.`);
            }
            tags.add(inbound.tag);
        }
    }

    private indexInbounds(): void {
        this.inboundsByTag.clear();
        for (const inbound of this.config.inbounds) this.inboundsByTag.set(inbound.tag, inbound);
    }

    private getNetwork(inbound: ISingBoxInbound): string | null {
        if (inbound.transport?.type) return inbound.transport.type;
        if (typeof inbound.network === 'string') return inbound.network;
        if (Array.isArray(inbound.network)) return inbound.network.join(',');
        if (inbound.type === 'hysteria2') return 'udp';
        if (inbound.type === 'anytls' || inbound.type === 'socks') return 'tcp';
        return null;
    }

    private readPemLines(path: string): string[] {
        return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n').filter(Boolean);
    }

    private replaceSnippetsInArray(
        array: TJsonRecord[] | undefined,
        snippets: Map<string, unknown>,
    ): void {
        if (!array) return;
        for (let index = array.length - 1; index >= 0; index--) {
            const name = array[index].snippet;
            if (typeof name !== 'string') continue;
            const snippet = snippets.get(name);
            if (Array.isArray(snippet)) array.splice(index, 1, ...(snippet as TJsonRecord[]));
            else if (snippet && typeof snippet === 'object') array[index] = snippet as TJsonRecord;
            else array.splice(index, 1);
        }
    }

    private sortObject(value: unknown): unknown {
        if (Array.isArray(value)) return value.map((item) => this.sortObject(item));
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(
            Object.entries(value as TJsonRecord)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, this.sortObject(item)]),
        );
    }
}
