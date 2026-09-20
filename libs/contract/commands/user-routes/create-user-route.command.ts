import { z } from 'zod';

import { REST_API, USER_ROUTES_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';
import { UserRouteSchema } from '../../models';

const port = z.number().int().min(1).max(65535);

export namespace CreateUserRouteCommand {
    export const url = REST_API.USER_ROUTES.CREATE;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.CREATE,
        'post',
        'Create user route',
        { scope: 'create', kind: 'write' },
    );
    export const RequestBodySchema = z.object({
        userId: z.number().int().positive(),
        nodeUuid: z.uuid(),
        configProfileInboundUuid: z.uuid(),
        hostUuid: z.uuid(),
        speedLimitUuid: z.uuid().nullable().optional(),
        portHoppingConfigUuid: z.uuid().nullable().optional(),
        externalPort: port.optional(),
        // Explicit acknowledgement that the original public core port can bypass GOST.
        allowPublicInbound: z.boolean().optional(),
        internalAddress: z.string().default('127.0.0.1'),
        internalPort: port,
        network: z.enum(['tcp', 'udp', 'tcp,udp']).default('tcp'),
        enabled: z.boolean().default(true),
    });
    export const ResponseSchema = z.object({ response: UserRouteSchema });
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
