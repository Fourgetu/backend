import { z } from 'zod';

import { REST_API, SYSTEM_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace GetTlsCertificateCommand {
    export const url = REST_API.SYSTEM.TLS_CERTIFICATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        SYSTEM_ROUTES.TLS_CERTIFICATE,
        'get',
        'Get Panel TLS Certificate Metadata',
        { scope: 'configuration', kind: 'read' },
        'Returns public metadata for the panel-managed TLS certificate. Private material is never returned.',
    );

    export const ResponseSchema = z.object({
        response: z.object({
            id: z.string(),
            source: z.literal('panel-reverse-proxy'),
            primaryDomain: z.string().nullable(),
            sans: z.array(z.string()),
            fingerprint: z.string().nullable(),
            notAfter: z.string().nullable(),
            updatedAt: z.string().nullable(),
            status: z.enum(['expired', 'invalid', 'ready', 'unconfigured']),
            statusMessage: z.string().nullable(),
        }),
    });

    export type Response = z.infer<typeof ResponseSchema>;
}
