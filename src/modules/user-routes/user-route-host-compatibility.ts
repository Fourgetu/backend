interface UserRouteHostBinding {
    configProfileInboundUuid: string | null;
    configProfileUuid: string | null;
    nodeUuids: string[];
}

interface UserRouteInboundBinding {
    profileUuid: string;
    uuid: string;
}

export function isHostCompatibleWithUserRoute(
    host: UserRouteHostBinding,
    nodeUuid: string,
    inbound: UserRouteInboundBinding,
): boolean {
    return (
        host.configProfileUuid === inbound.profileUuid &&
        host.configProfileInboundUuid === inbound.uuid &&
        (host.nodeUuids.length === 0 || host.nodeUuids.includes(nodeUuid))
    );
}
