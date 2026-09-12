export const CONFIG_PROFILE_CORE_TYPE = {
    XRAY: 'xray',
    SINGBOX: 'singbox',
} as const;

export type TConfigProfileCoreType =
    (typeof CONFIG_PROFILE_CORE_TYPE)[keyof typeof CONFIG_PROFILE_CORE_TYPE];
