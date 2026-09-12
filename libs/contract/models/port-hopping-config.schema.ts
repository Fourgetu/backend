import { z } from 'zod';

export const PortHoppingConfigSchema = z.object({
    uuid: z.uuid(),
    configProfileInboundUuid: z.uuid(),
    enabled: z.boolean(),
    poolStart: z.int().min(1).max(65_535),
    poolEnd: z.int().min(1).max(65_535),
    portsPerUser: z.int().min(2).max(1_024),
    hopIntervalSeconds: z.int().min(1).max(86_400),
    createdAt: z.iso.datetime().transform((value) => new Date(value)),
    updatedAt: z.iso.datetime().transform((value) => new Date(value)),
});

export type PortHoppingConfig = z.infer<typeof PortHoppingConfigSchema>;
