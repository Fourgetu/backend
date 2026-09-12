import { z } from 'zod';

import { REST_API, USER_ROUTES_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';
import { UserRouteSchema } from '../../models';

const port = z.number().int().min(1).max(65535);

export namespace UpdateUserRouteCommand {
    export const url = REST_API.USER_ROUTES.UPDATE;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.UPDATE,
        'patch',
        'Update user route',
        { scope: 'update', kind: 'write' },
    );
    export const RequestBodySchema = z.object({
        uuid: z.uuid(),
        speedLimitUuid: z.uuid().nullable().optional(),
        portHoppingConfigUuid: z.uuid().nullable().optional(),
        externalPort: port.optional(),
        internalAddress: z.string().optional(),
        internalPort: port.optional(),
        network: z.enum(['tcp', 'udp']).optional(),
        enabled: z.boolean().optional(),
    });
    export const ResponseSchema = z.object({ response: UserRouteSchema });
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
