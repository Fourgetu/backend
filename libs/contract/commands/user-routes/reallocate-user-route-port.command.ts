import { z } from 'zod';

import { REST_API, USER_ROUTES_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';
import { UserRouteSchema } from '../../models';

export namespace ReallocateUserRoutePortCommand {
    export const url = REST_API.USER_ROUTES.REALLOCATE_PORT;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.REALLOCATE_PORT(':uuid'),
        'post',
        'Reallocate user route external port',
        { scope: 'update', kind: 'write' },
    );
    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export const ResponseSchema = z.object({ response: UserRouteSchema });
    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
