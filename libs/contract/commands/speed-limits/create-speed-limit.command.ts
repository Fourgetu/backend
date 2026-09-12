import { REST_API, SPEED_LIMITS_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';
import { SpeedLimitSchema } from '../../models';
import { z } from 'zod';

const speed = z.number().int().nonnegative();

export namespace CreateSpeedLimitCommand {
    export const url = REST_API.SPEED_LIMITS.CREATE;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        SPEED_LIMITS_ROUTES.CREATE,
        'post',
        'Create speed limit',
        { scope: 'create', kind: 'write' },
    );
    export const RequestBodySchema = z.object({
        name: z.string().trim().min(1).max(100),
        downloadBytesPerSecond: speed.default(0),
        uploadBytesPerSecond: speed.default(0),
        enabled: z.boolean().default(true),
    });
    export const ResponseSchema = z.object({ response: SpeedLimitSchema });
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
