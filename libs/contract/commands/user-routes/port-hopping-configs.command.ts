import { z } from 'zod';

import { REST_API, USER_ROUTES_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';
import { PortHoppingConfigSchema } from '../../models';

const port = z.number().int().min(1).max(65_535);
const fields = {
    enabled: z.boolean(),
    poolStart: port,
    poolEnd: port,
    portsPerUser: z.number().int().min(2).max(1_024),
    hopIntervalSeconds: z.number().int().min(1).max(86_400),
};

export namespace GetPortHoppingConfigsCommand {
    export const url = REST_API.USER_ROUTES.PORT_HOPPING_CONFIGS;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.PORT_HOPPING_CONFIGS,
        'get',
        'Get Hysteria2 port hopping configs',
        { scope: 'read', kind: 'read' },
    );
    export const RequestQuerySchema = z.object({ configProfileInboundUuid: z.uuid().optional() });
    export const ResponseSchema = z.object({ response: z.array(PortHoppingConfigSchema) });
}

export namespace CreatePortHoppingConfigCommand {
    export const url = REST_API.USER_ROUTES.PORT_HOPPING_CONFIGS;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.PORT_HOPPING_CONFIGS,
        'post',
        'Create Hysteria2 port hopping config',
        { scope: 'create', kind: 'write' },
    );
    export const RequestBodySchema = z.object({
        configProfileInboundUuid: z.uuid(),
        ...fields,
    });
    export const ResponseSchema = z.object({ response: PortHoppingConfigSchema });
}

export namespace UpdatePortHoppingConfigCommand {
    export const url = REST_API.USER_ROUTES.PORT_HOPPING_CONFIG;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.PORT_HOPPING_CONFIG(':uuid'),
        'patch',
        'Update Hysteria2 port hopping config',
        { scope: 'update', kind: 'write' },
    );
    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export const RequestBodySchema = z.object(fields).partial();
    export const ResponseSchema = z.object({ response: PortHoppingConfigSchema });
}

export namespace DeletePortHoppingConfigCommand {
    export const url = REST_API.USER_ROUTES.PORT_HOPPING_CONFIG;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        USER_ROUTES_ROUTES.PORT_HOPPING_CONFIG(':uuid'),
        'delete',
        'Delete Hysteria2 port hopping config',
        { scope: 'delete', kind: 'write' },
    );
    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export const ResponseSchema = z.object({ response: z.boolean() });
}
