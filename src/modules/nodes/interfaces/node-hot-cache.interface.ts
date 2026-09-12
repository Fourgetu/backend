import { INodeSystem } from './node-host-info.interface';

export interface INodeVersions {
    xray: string;
    singbox?: string;
    gost?: string;
    node: string;
}

export type TNodeRuntimeStatus = 'running' | 'stopped' | 'unavailable' | 'unknown';

export interface INodeRuntimeHealth {
    observedAt: string;
    xray: { status: TNodeRuntimeStatus; version: string | null };
    singbox: { status: TNodeRuntimeStatus; version: string | null };
    gost: {
        status: TNodeRuntimeStatus;
        version: string | null;
        installed: boolean | null;
        services: number | null;
    };
}

export interface INodeHotCache {
    system: INodeSystem | null;
    versions: INodeVersions | null;
    xrayUptime: number;
    onlineUsers: number;
    runtimeHealth: INodeRuntimeHealth | null;
}
