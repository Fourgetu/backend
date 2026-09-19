import { AxiosService, INodeConnectionOpts } from '@common/axios';
import { PrismaService } from '@common/database/prisma.service';
import { ok } from '@common/types';

/**
 * Rebuild the complete desired GOST state for one node.
 *
 * Queue workers call this directly because Nest's in-process event emitter does
 * not cross the REST/processor process boundary.
 */
export async function reconcileGostForwards(
    prisma: PrismaService,
    axios: AxiosService,
    nodeUuid: string,
    connectionOpts: INodeConnectionOpts,
) {
    const routes = await prisma.userRoutes.findMany({
        where: { nodeUuid },
        include: {
            speedLimit: {
                select: {
                    downloadBytesPerSecond: true,
                    uploadBytesPerSecond: true,
                    enabled: true,
                },
            },
            portHoppingConfig: {
                select: {
                    enabled: true,
                    hopIntervalSeconds: true,
                },
            },
        },
        orderBy: [{ externalPort: 'asc' }, { network: 'asc' }],
    });

    const result = await axios.syncGostForwards(
        {
            forwards: routes.map((route) => ({
                id: route.uuid,
                externalPort: route.externalPort,
                internalAddress: route.internalAddress as '127.0.0.1' | '::1',
                internalPort: route.internalPort,
                network: route.network as 'tcp' | 'udp',
                downloadBytesPerSecond:
                    route.speedLimit?.enabled && route.speedLimit.downloadBytesPerSecond
                        ? Number(route.speedLimit.downloadBytesPerSecond)
                        : 0,
                uploadBytesPerSecond:
                    route.speedLimit?.enabled && route.speedLimit.uploadBytesPerSecond
                        ? Number(route.speedLimit.uploadBytesPerSecond)
                        : 0,
                enabled: route.enabled,
                ...(route.portHoppingConfig?.enabled && route.hopStartPort !== null
                    ? { hopStartPort: route.hopStartPort }
                    : {}),
                ...(route.portHoppingConfig?.enabled && route.hopEndPort !== null
                    ? { hopEndPort: route.hopEndPort }
                    : {}),
                ...(route.portHoppingConfig?.enabled
                    ? { hopIntervalSeconds: route.portHoppingConfig.hopIntervalSeconds }
                    : {}),
            })),
        },
        { ...connectionOpts, nodeUuid },
    );

    if (!result.isOk) return result;

    return ok({
        ...result.response,
        requiresPortHopping: routes.some(
            (route) =>
                route.enabled &&
                route.portHoppingConfig?.enabled &&
                route.hopStartPort !== null &&
                route.hopEndPort !== null,
        ),
    });
}
