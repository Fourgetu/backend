export type UserRouteNetwork = 'tcp' | 'udp' | 'tcp,udp';

export function resolveUserRouteNetwork(raw: unknown): UserRouteNetwork {
    const inbound = raw as {
        type?: string;
        protocol?: string;
        network?: string;
        settings?: { network?: string };
        streamSettings?: { network?: string };
    } | null;
    if (!inbound || typeof inbound !== 'object') return 'tcp';
    if (inbound.protocol === 'hysteria' || inbound.type === 'hysteria2') return 'udp';
    if (inbound.protocol === 'shadowsocks' || inbound.type === 'shadowsocks') {
        const network = inbound.type ? inbound.network : inbound.settings?.network;
        return network === 'tcp' || network === 'udp' ? network : 'tcp,udp';
    }
    return ['hysteria', 'quic'].includes(inbound.streamSettings?.network ?? '') ? 'udp' : 'tcp';
}

export function splitUserRouteNetwork(network: string): ('tcp' | 'udp')[] {
    if (network === 'tcp,udp') return ['tcp', 'udp'];
    if (network === 'tcp' || network === 'udp') return [network];
    throw new Error('Unsupported GOST route network');
}

// The legacy singular field identifies the primary listener; combined routes
// additionally have a "-udp" service sharing the same forward UUID/limiter.
export const userRouteServiceName = (uuid: string, network: string): string =>
    `user-route-${uuid}-${splitUserRouteNetwork(network)[0]}`;
