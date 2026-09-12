export const USER_ROUTES_CONTROLLER = 'user-routes' as const;

export const USER_ROUTES_ROUTES = {
    GET: '',
    CREATE: '',
    UPDATE: '',
    DELETE: (uuid: string) => uuid,
    RUNTIME_STATUS: (nodeUuid: string) => `runtime/${nodeUuid}`,
    REALLOCATE_PORT: (uuid: string) => `${uuid}/reallocate-port`,
    PORT_HOPPING_CONFIGS: 'port-hopping-configs',
    PORT_HOPPING_CONFIG: (uuid: string) => `port-hopping-configs/${uuid}`,
} as const;
