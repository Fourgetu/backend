import { Prisma } from '@prisma/client';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';

type TransactionClient = Prisma.TransactionClient;

interface PortHoppingConfigShape {
    uuid: string;
    enabled: boolean;
    poolStart: number;
    poolEnd: number;
    portsPerUser: number;
    hopIntervalSeconds: number;
}

export interface PortRangeAllocation {
    start: number;
    end: number;
}

export interface PortRangeConflict {
    end: number;
    source: 'host' | 'inbound' | 'user-route' | 'hopping-allocation';
    sourceUuid: string;
    start: number;
}

@Injectable()
export class PortRangeAllocator {
    constructor(private readonly prisma: PrismaService) {}

    public validate(config: PortHoppingConfigShape): string[] {
        const errors: string[] = [];
        if (!Number.isInteger(config.poolStart) || config.poolStart < 1 || config.poolStart > 65_535)
            errors.push('poolStart');
        if (!Number.isInteger(config.poolEnd) || config.poolEnd < 1 || config.poolEnd > 65_535)
            errors.push('poolEnd');
        if (config.poolStart > config.poolEnd) errors.push('poolRange');
        if (
            !Number.isInteger(config.portsPerUser) ||
            config.portsPerUser < 2 ||
            config.portsPerUser > 1_024
        )
            errors.push('portsPerUser');
        if (config.portsPerUser > config.poolEnd - config.poolStart + 1)
            errors.push('poolCapacity');
        if (
            !Number.isInteger(config.hopIntervalSeconds) ||
            config.hopIntervalSeconds < 1 ||
            config.hopIntervalSeconds > 86_400
        )
            errors.push('hopIntervalSeconds');
        return errors;
    }

    public async detectConflict(
        nodeUuid: string,
        start: number,
        end: number,
        excludeRouteUuid?: string,
    ): Promise<PortRangeConflict[]> {
        return this.detectConflictWithClient(
            this.prisma,
            nodeUuid,
            start,
            end,
            excludeRouteUuid,
        );
    }

    /** Allocates and persists the first deterministic free block for an existing UserRoute. */
    public async allocate(
        routeUuid: string,
        configUuid: string,
    ): Promise<PortRangeAllocation> {
        return this.prisma.$transaction(
            async (tx) => {
                const route = await tx.userRoutes.findUnique({ where: { uuid: routeUuid } });
                if (!route) throw new Error(`UserRoute ${routeUuid} does not exist.`);

                const config = await tx.portHoppingConfigs.findUnique({
                    where: { uuid: configUuid },
                });
                if (!config) throw new Error(`PortHoppingConfig ${configUuid} does not exist.`);

                const invalid = this.validate(config);
                if (invalid.length > 0)
                    throw new Error(`Invalid PortHoppingConfig fields: ${invalid.join(', ')}`);
                if (!config.enabled) throw new Error('PortHoppingConfig is disabled.');

                await tx.$queryRaw`
                    SELECT pg_advisory_xact_lock(
                        hashtextextended(${`${configUuid}:${route.nodeUuid}`}, 0)
                    )
                `;

                const refreshed = await tx.userRoutes.findUniqueOrThrow({
                    where: { uuid: routeUuid },
                });
                if (
                    refreshed.portHoppingConfigUuid === configUuid &&
                    refreshed.hopStartPort !== null &&
                    refreshed.hopEndPort !== null
                ) {
                    return { start: refreshed.hopStartPort, end: refreshed.hopEndPort };
                }

                for (
                    let start = config.poolStart;
                    start + config.portsPerUser - 1 <= config.poolEnd;
                    start += config.portsPerUser
                ) {
                    const end = start + config.portsPerUser - 1;
                    const conflicts = await this.detectConflictWithClient(
                        tx,
                        route.nodeUuid,
                        start,
                        end,
                        route.uuid,
                    );
                    if (conflicts.length > 0) continue;

                    await tx.userRoutes.update({
                        where: { uuid: route.uuid },
                        data: {
                            portHoppingConfigUuid: config.uuid,
                            hopStartPort: start,
                            hopEndPort: end,
                        },
                    });
                    return { start, end };
                }

                throw new Error(
                    `No free ${config.portsPerUser}-port block remains in ${config.poolStart}-${config.poolEnd}.`,
                );
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
    }

    public async release(routeUuid: string): Promise<void> {
        await this.prisma.userRoutes.update({
            where: { uuid: routeUuid },
            data: {
                portHoppingConfigUuid: null,
                hopStartPort: null,
                hopEndPort: null,
            },
        });
    }

    /**
     * Reconstructs the desired allocation map without randomizing or silently
     * repairing stored ranges. Invalid persisted state is returned as an issue
     * so startup reconciliation can refuse unsafe ingress rules.
     */
    public async restoreDesiredState(): Promise<{
        allocations: Array<
            PortRangeAllocation & { configUuid: string; nodeUuid: string; routeUuid: string }
        >;
        issues: Array<{ message: string; nodeUuid: string; routeUuid: string }>;
    }> {
        const routes = await this.prisma.userRoutes.findMany({
            where: { portHoppingConfigUuid: { not: null } },
            include: { portHoppingConfig: true },
            orderBy: [{ nodeUuid: 'asc' }, { hopStartPort: 'asc' }],
        });
        const allocations: Array<
            PortRangeAllocation & { configUuid: string; nodeUuid: string; routeUuid: string }
        > = [];
        const issues: Array<{ message: string; nodeUuid: string; routeUuid: string }> = [];

        for (const route of routes) {
            const config = route.portHoppingConfig;
            if (!config || route.hopStartPort === null || route.hopEndPort === null) {
                issues.push({
                    routeUuid: route.uuid,
                    nodeUuid: route.nodeUuid,
                    message: `Route ${route.uuid} has an incomplete hopping allocation.`,
                });
                continue;
            }
            const rangeSize = route.hopEndPort - route.hopStartPort + 1;
            if (
                !config.enabled ||
                route.hopStartPort < config.poolStart ||
                route.hopEndPort > config.poolEnd ||
                rangeSize !== config.portsPerUser
            ) {
                issues.push({
                    routeUuid: route.uuid,
                    nodeUuid: route.nodeUuid,
                    message: `Route ${route.uuid} has an allocation outside its active pool.`,
                });
                continue;
            }
            const conflicts = await this.detectConflict(
                route.nodeUuid,
                route.hopStartPort,
                route.hopEndPort,
                route.uuid,
            );
            if (conflicts.length > 0) {
                issues.push({
                    routeUuid: route.uuid,
                    nodeUuid: route.nodeUuid,
                    message: `Route ${route.uuid} overlaps ${conflicts[0].source}.`,
                });
                continue;
            }
            allocations.push({
                routeUuid: route.uuid,
                configUuid: config.uuid,
                nodeUuid: route.nodeUuid,
                start: route.hopStartPort,
                end: route.hopEndPort,
            });
        }

        return { allocations, issues };
    }

    private async detectConflictWithClient(
        client: TransactionClient | PrismaService,
        nodeUuid: string,
        start: number,
        end: number,
        excludeRouteUuid?: string,
    ): Promise<PortRangeConflict[]> {
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65_535)
            throw new Error('Port range must be within 1-65535.');
        if (start > end) throw new Error('Port range start must not exceed end.');

        const [routes, hosts, inbounds] = await Promise.all([
            client.userRoutes.findMany({
                where: {
                    nodeUuid,
                    ...(excludeRouteUuid ? { uuid: { not: excludeRouteUuid } } : {}),
                    OR: [
                        { externalPort: { gte: start, lte: end } },
                        { hopStartPort: { lte: end }, hopEndPort: { gte: start } },
                    ],
                },
                select: {
                    uuid: true,
                    externalPort: true,
                    hopStartPort: true,
                    hopEndPort: true,
                },
            }),
            client.hostsToNodes.findMany({
                where: { nodeUuid, host: { port: { gte: start, lte: end } } },
                select: { host: { select: { uuid: true, port: true } } },
            }),
            client.configProfileInboundsToNodes.findMany({
                where: {
                    nodeUuid,
                    configProfileInbounds: { port: { gte: start, lte: end } },
                },
                select: {
                    configProfileInbounds: { select: { uuid: true, port: true } },
                },
            }),
        ]);

        return [
            ...routes.flatMap((route): PortRangeConflict[] => [
                ...(route.externalPort >= start && route.externalPort <= end
                    ? [
                          {
                              source: 'user-route' as const,
                              sourceUuid: route.uuid,
                              start: route.externalPort,
                              end: route.externalPort,
                          },
                      ]
                    : []),
                ...(route.hopStartPort !== null && route.hopEndPort !== null
                    ? [
                          {
                              source: 'hopping-allocation' as const,
                              sourceUuid: route.uuid,
                              start: route.hopStartPort,
                              end: route.hopEndPort,
                          },
                      ]
                    : []),
            ]),
            ...hosts.map(({ host }) => ({
                source: 'host' as const,
                sourceUuid: host.uuid,
                start: host.port,
                end: host.port,
            })),
            ...inbounds.flatMap(({ configProfileInbounds: inbound }) =>
                inbound.port === null
                    ? []
                    : [
                          {
                              source: 'inbound' as const,
                              sourceUuid: inbound.uuid,
                              start: inbound.port,
                              end: inbound.port,
                          },
                      ],
            ),
        ];
    }
}
