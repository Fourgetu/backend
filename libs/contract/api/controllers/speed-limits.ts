export const SPEED_LIMITS_CONTROLLER = 'speed-limits' as const;

export const SPEED_LIMITS_ROUTES = {
    GET: '',
    CREATE: '',
    UPDATE: '',
    DELETE: (uuid: string) => uuid,
} as const;
