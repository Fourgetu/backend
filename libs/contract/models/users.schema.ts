import { z } from 'zod';

import { RESET_PERIODS, USERS_STATUS } from '../constants';

export const UsersSchema = z.object({
    id: z.number(),
    shortUuid: z.string(),
    username: z.string(),
    status: z.enum(USERS_STATUS),
    trafficLimitBytes: z.number(),
    trafficLimitStrategy: z.enum(RESET_PERIODS).describe('Available reset periods'),
    trafficLimitResetDay: z.number().int().min(1).max(31).nullable(),
    expireAt: z.iso.datetime().transform((str) => new Date(str)),
    telegramId: z.nullable(z.number()),
    email: z.nullable(z.email()),
    description: z.nullable(z.string()),
    tag: z.nullable(z.string()),
    hwidDeviceLimit: z.nullable(z.int()),
    externalSquadUuid: z.nullable(z.uuid()),
    trojanPassword: z.string(),
    vlessUuid: z.guid(),
    ssPassword: z.string(),
    socksUsername: z.string(),
    socksPassword: z.string(),
    lastTriggeredThreshold: z.int(),
    subRevokedAt: z.nullable(z.iso.datetime().transform((str) => new Date(str))),
    lastTrafficResetAt: z.nullable(z.iso.datetime().transform((str) => new Date(str))),
    createdAt: z.iso.datetime().transform((str) => new Date(str)),
    updatedAt: z.iso.datetime().transform((str) => new Date(str)),
});
