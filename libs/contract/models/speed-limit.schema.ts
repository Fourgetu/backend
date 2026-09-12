import { z } from 'zod';

export const SpeedLimitSchema = z.object({
    uuid: z.uuid(),
    name: z.string(),
    downloadBytesPerSecond: z.number(),
    uploadBytesPerSecond: z.number(),
    enabled: z.boolean(),
    createdAt: z.iso.datetime().transform((value) => new Date(value)),
    updatedAt: z.iso.datetime().transform((value) => new Date(value)),
});

export type SpeedLimit = z.infer<typeof SpeedLimitSchema>;
