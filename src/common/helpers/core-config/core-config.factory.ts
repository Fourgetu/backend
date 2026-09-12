import { CONFIG_PROFILE_CORE_TYPE, TConfigProfileCoreType } from '@libs/contracts/constants';

import { XRayConfig } from '../xray-config';
import { ICoreConfig } from './core-config.interface';
import { SingBoxConfig } from './singbox-config.validator';

export function createCoreConfig(
    coreType: TConfigProfileCoreType,
    config: object | Record<string, unknown> | string,
): ICoreConfig {
    switch (coreType) {
        case CONFIG_PROFILE_CORE_TYPE.XRAY:
            return new XRayConfig(config);
        case CONFIG_PROFILE_CORE_TYPE.SINGBOX:
            return new SingBoxConfig(config);
    }
}
