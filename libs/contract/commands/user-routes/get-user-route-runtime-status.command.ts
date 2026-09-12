import { z } from 'zod';

import { REST_API, USER_ROUTES_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace GetUserRouteRuntimeStatusCommand {
    export const url = REST_API.USER_ROUTES.RUNTIME_STATUS;
    export const TSQ_url = url(':nodeUuid');
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.RUNTIME_STATUS(':nodeUuid'),
        'get',
        'Get user route GOST runtime status',
        { scope: 'read', kind: 'read' },
    );
    export const RequestParamSchema = z.object({ nodeUuid: z.uuid() });
    export const ResponseSchema = z.object({
        response: z.object({
            nodeUuid: z.uuid(),
            running: z.boolean(),
            installed: z.boolean(),
            gostVersion: z.string().nullable(),
            services: z.number().int().nonnegative(),
            configPath: z.string(),
            error: z.string().nullable(),
            portHopping: z.object({
                mode: z.enum(['disabled', 'nftables']),
                available: z.boolean(),
                applied: z.boolean(),
                requiresNetAdmin: z.literal(true),
                rules: z.number().int().nonnegative(),
                error: z.string().nullable(),
            }),
        }),
    });
    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
