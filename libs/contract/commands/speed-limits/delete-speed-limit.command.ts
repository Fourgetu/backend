import { z } from 'zod';

import { REST_API, SPEED_LIMITS_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace DeleteSpeedLimitCommand {
    export const url = REST_API.SPEED_LIMITS.DELETE;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        SPEED_LIMITS_ROUTES.DELETE(':uuid'),
        'delete',
        'Delete speed limit',
        { scope: 'delete', kind: 'write' },
    );
    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export type RequestParam = z.infer<typeof RequestParamSchema>;
}
