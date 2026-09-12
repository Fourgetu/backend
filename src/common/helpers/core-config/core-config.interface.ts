import { HashedSet } from '@remnawave/hashed-set';

import { UserForConfigEntity } from '@modules/users/entities/users-for-config';

export interface ICoreConfigInbound {
    tag: string;
    type: string;
    network: string | null;
    security: string | null;
    port: number | null;
    rawInbound: object | null;
}

export interface ICoreConfig {
    getConfig(): object;
    getSortedConfig(): object;
    getConfigHash(): string;
    getAllInbounds(): ICoreConfigInbound[];
    cleanInboundClients(injectFlow: boolean): void;
    processCertificates(): object;
    replaceSnippets(snippets: Map<string, unknown>): void;
    leaveInbounds(tags: Set<string>): void;
    includeUserBatch(
        users: UserForConfigEntity[],
        inboundsUserSets: Map<string, HashedSet>,
    ): object;
    finalizeInboundClients(): void;
    fixIncorrectServerNames(): void;
    validateOutbounds?(): void;
}
