/**
 * Public-inbound compatibility is an explicit creation-time opt-in, not a
 * change to the proxy listener or firewall. GOST always targets loopback.
 */
export const isUserRouteListenerAllowed = ({
    listen,
    coreType,
    internalAddress,
    allowPublicInbound,
}: {
    listen: unknown;
    coreType: unknown;
    internalAddress: string;
    allowPublicInbound?: boolean;
}): boolean => {
    if (listen === '127.0.0.1' || listen === '::1') {
        return internalAddress === listen;
    }
    return (
        allowPublicInbound === true &&
        (coreType === 'xray' || coreType === 'singbox') &&
        ((listen === '0.0.0.0' && internalAddress === '127.0.0.1') ||
            (listen === '::' && internalAddress === '::1'))
    );
};
