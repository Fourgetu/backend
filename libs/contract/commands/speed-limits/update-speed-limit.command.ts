import { REST_API, SPEED_LIMITS_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';
import { SpeedLimitSchema } from '../../models';
import { z } from 'zod';

const speed = z.number().int().nonnegative();

export namespace UpdateSpeedLimitCommand {
    export const url = REST_API.SPEED_LIMITS.UPDATE;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        SPEED_LIMITS_ROUTES.UPDATE,
        'patch',
        'Update speed limit',
        { scope: 'update', kind: 'write' },
    );
    export const RequestBodySchema = z.object({
        uuid: z.uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        downloadBytesPerSecond: speed.optional(),
        uploadBytesPerSecond: speed.optional(),
        enabled: z.boolean().optional(),
    });
    export const ResponseSchema = z.object({ response: SpeedLimitSchema });
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
