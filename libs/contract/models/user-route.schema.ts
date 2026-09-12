import { z } from 'zod';

export const UserRouteSchema = z.object({
    uuid: z.uuid(),
    userId: z.number(),
    nodeUuid: z.uuid(),
    configProfileInboundUuid: z.uuid(),
    hostUuid: z.uuid(),
    speedLimitUuid: z.uuid().nullable(),
    portHoppingConfigUuid: z.uuid().nullable(),
    externalPort: z.int().min(1).max(65535),
    internalAddress: z.string(),
    internalPort: z.int().min(1).max(65535),
    gostForwardId: z.string().nullable(),
    gostServiceName: z.string().nullable(),
    network: z.string(),
    enabled: z.boolean(),
    hopStartPort: z.int().min(1).max(65535).nullable(),
    hopEndPort: z.int().min(1).max(65535).nullable(),
    createdAt: z.iso.datetime().transform((value) => new Date(value)),
    updatedAt: z.iso.datetime().transform((value) => new Date(value)),
});

export type UserRoute = z.infer<typeof UserRouteSchema>;
