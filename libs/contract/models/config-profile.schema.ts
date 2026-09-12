import { z } from 'zod';

import { CONFIG_PROFILE_CORE_TYPE } from '../constants';
import { ConfigProfileInboundsSchema } from './config-profile-inbounds.schema';

export const ConfigProfileSchema = z.object({
    uuid: z.uuid(),
    viewPosition: z.int(),
    name: z.string(),
    coreType: z.enum([CONFIG_PROFILE_CORE_TYPE.XRAY, CONFIG_PROFILE_CORE_TYPE.SINGBOX]),
    tags: z.array(z.string()),
    config: z.unknown(),
    inbounds: z.array(ConfigProfileInboundsSchema),
    nodes: z.array(
        z.object({
            uuid: z.uuid(),
            name: z.string(),
            countryCode: z.string(),
        }),
    ),

    createdAt: z.iso.datetime().transform((str) => new Date(str)),
    updatedAt: z.iso.datetime().transform((str) => new Date(str)),
});
