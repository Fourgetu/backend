import { z } from 'zod';

import { REST_API, USER_ROUTES_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace DeleteUserRouteCommand {
    export const url = REST_API.USER_ROUTES.DELETE;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.DELETE(':uuid'),
        'delete',
        'Delete user route',
        { scope: 'delete', kind: 'write' },
    );
    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export type RequestParam = z.infer<typeof RequestParamSchema>;
}
