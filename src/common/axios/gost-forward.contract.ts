export const GOST_NODE_API = {
    syncForwards: '/node/gost/sync-forwards',
    health: '/node/gost/health',
} as const;

export interface GostForwardSyncRequest {
    forwards: Array<{
        id: string;
        externalPort: number;
        internalAddress: '127.0.0.1' | '::1';
        internalPort: number;
        network: 'tcp' | 'udp';
        downloadBytesPerSecond: number;
        uploadBytesPerSecond: number;
        enabled: boolean;
        hopStartPort?: number;
        hopEndPort?: number;
        hopIntervalSeconds?: number;
    }>;
}

export interface PortHoppingRuntimeResponse {
    mode: 'disabled' | 'nftables';
    available: boolean;
    applied: boolean;
    requiresNetAdmin: true;
    rules: number;
    error: string | null;
}

export interface GostForwardSyncResponse {
    applied: boolean;
    running: boolean;
    installed: boolean;
    gostVersion: string | null;
    services: number;
    configPath: string;
    error: string | null;
    portHopping: PortHoppingRuntimeResponse;
}

export interface GostHealthResponse {
    running: boolean;
    installed: boolean;
    gostVersion: string | null;
    services: number;
    configPath: string;
    error: string | null;
    portHopping: PortHoppingRuntimeResponse;
}
