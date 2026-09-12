import { REST_API, SPEED_LIMITS_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';
import { SpeedLimitSchema } from '../../models';
import { z } from 'zod';

export namespace GetSpeedLimitsCommand {
    export const url = REST_API.SPEED_LIMITS.GET;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        SPEED_LIMITS_ROUTES.GET,
        'get',
        'Get speed limits',
        { scope: 'read', kind: 'read' },
    );
    export const ResponseSchema = z.object({ response: z.array(SpeedLimitSchema) });
    export type Response = z.infer<typeof ResponseSchema>;
}
