export function singBoxVlessFlow(inbound: {
    type?: string;
    transport?: unknown;
    tls?: { enabled?: boolean; reality?: { enabled?: boolean } };
}): '' | 'xtls-rprx-vision' {
    return inbound.type === 'vless' &&
        inbound.tls?.enabled &&
        inbound.tls.reality?.enabled &&
        !inbound.transport
        ? 'xtls-rprx-vision'
        : '';
}
