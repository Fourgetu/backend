import { z } from 'zod';

import { REST_API, USER_ROUTES_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';
import { UserRouteSchema } from '../../models';

export namespace GetUserRoutesCommand {
    export const url = REST_API.USER_ROUTES.GET;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.GET,
        'get',
        'Get user routes',
        { scope: 'read', kind: 'read' },
    );
    export const RequestQuerySchema = z.object({
        userId: z.coerce.number().int().positive().optional(),
        nodeUuid: z.uuid().optional(),
    });
    export const ResponseSchema = z.object({ response: z.array(UserRouteSchema) });
    export type RequestQuery = z.infer<typeof RequestQuerySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
