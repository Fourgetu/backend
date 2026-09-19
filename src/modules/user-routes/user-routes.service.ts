import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AxiosService } from '@common/axios';
import { GOST_NODE_API } from '@common/axios/gost-forward.contract';
import { PrismaService } from '@common/database/prisma.service';
import { fail, ok, TResult } from '@common/types';
import { ERRORS, EVENTS } from '@libs/contracts/constants';

import { NodeEvent } from '@integration-modules/notifications/interfaces';

import { NodesRepository } from '@modules/nodes/repositories/nodes.repository';

import { CreateUserRouteBodyDto, GetUserRoutesQueryDto, UpdateUserRouteBodyDto } from './dtos';
import { UserRouteEntity } from './entities';
import { PortRangeAllocator } from './port-range-allocator.service';
import { UserRoutesRepository } from './repositories';
import { isHostCompatibleWithUserRoute } from './user-route-host-compatibility';

const DEFAULT_PORT_START = 32000;
const DEFAULT_PORT_END = 32999;

@Injectable()
export class UserRoutesService implements OnApplicationBootstrap {
    private readonly logger = new Logger(UserRoutesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly repository: UserRoutesRepository,
        private readonly axiosService: AxiosService,
        private readonly nodesRepository: NodesRepository,
        private readonly portRangeAllocator: PortRangeAllocator,
    ) {}

    /**
     * Rebuild GOST's desired state after the panel process starts. This is deliberately
     * best-effort: an offline node must not prevent the REST API from booting.
     */
    async onApplicationBootstrap(): Promise<void> {
        try {
            const legacyRoutes = await this.prisma.userRoutes.findMany({
                where: { OR: [{ gostForwardId: null }, { gostServiceName: null }] },
                select: { uuid: true, network: true },
            });
            await Promise.all(
                legacyRoutes.map((route) =>
                    this.prisma.userRoutes.update({
                        where: { uuid: route.uuid },
                        data: {
                            gostForwardId: route.uuid,
                            gostServiceName: `user-route-${route.uuid}-${route.network}`,
                        },
                    }),
                ),
            );

            const nodeRows = await this.prisma.userRoutes.findMany({
                distinct: ['nodeUuid'],
                select: { nodeUuid: true },
            });

            for (const { nodeUuid } of nodeRows) {
                const result = await this.syncNode(nodeUuid);
                if (!result.isOk || !result.response.applied) {
                    this.logger.warn(
                        `GOST startup reconcile skipped for node ${nodeUuid}: ${
                            result.isOk
                                ? (result.response.error ?? 'runtime rejected configuration')
                                : (result.message ?? 'node runtime unavailable')
                        }`,
                    );
                }
            }
        } catch (error) {
            this.logger.warn(`GOST startup reconcile failed: ${String(error)}`);
        }
    }

    @OnEvent(EVENTS.NODE.CONNECTION_RESTORED, { async: true })
    async onNodeConnectionRestored(event: NodeEvent): Promise<void> {
        try {
            const result = await this.syncNode(event.node.uuid);
            if (!result.isOk || !result.response.applied) {
                this.logger.warn(
                    `GOST reconnect reconcile failed for node ${event.node.uuid}: ${
                        result.isOk
                            ? (result.response.error ?? 'runtime rejected configuration')
                            : (result.message ?? 'node runtime unavailable')
                    }`,
                );
            }
        } catch (error) {
            this.logger.warn(
                `GOST reconnect reconcile failed for node ${event.node.uuid}: ${String(error)}`,
            );
        }
    }

    async getAll(dto: GetUserRoutesQueryDto): Promise<TResult<UserRouteEntity[]>> {
        try {
            return ok(await this.repository.findAll(dto));
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_USER_ROUTES_ERROR);
        }
    }

    async getRuntimeStatus(nodeUuid: string) {
        const node = await this.nodesRepository.findByUUID(nodeUuid);
        if (!node || !node.port) {
            return fail(
                ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                    `Node ${nodeUuid} is not connected or has no API port`,
                ),
            );
        }

        const health = await this.axiosService.getGostHealth({
            nodeUuid,
            address: node.address,
            port: node.port,
            proxyUrl: node.proxyUrl,
        });
        if (!health.isOk) return health;

        return ok({ nodeUuid, ...health.response });
    }

    async create(dto: CreateUserRouteBodyDto): Promise<TResult<UserRouteEntity>> {
        try {
            const references = await this.validateReferences(dto);
            if (!references.isOk) return references;

            const externalPort =
                dto.externalPort ?? (await this.allocatePort(dto.nodeUuid, dto.network));
            if (externalPort === null) return fail(ERRORS.USER_ROUTE_PORT_ALREADY_EXISTS);

            const reserved = await this.repository.listPorts(dto.nodeUuid, dto.network);
            if (reserved.includes(externalPort)) return fail(ERRORS.USER_ROUTE_PORT_ALREADY_EXISTS);
            if (
                (
                    await this.portRangeAllocator.detectConflict(
                        dto.nodeUuid,
                        externalPort,
                        externalPort,
                    )
                ).length > 0
            ) {
                return fail(ERRORS.USER_ROUTE_PORT_ALREADY_EXISTS);
            }

            const routeUuid = randomUUID();

            const route = await this.repository.create({
                uuid: routeUuid,
                userId: BigInt(dto.userId),
                nodeUuid: dto.nodeUuid,
                configProfileInboundUuid: dto.configProfileInboundUuid,
                hostUuid: dto.hostUuid,
                speedLimitUuid: dto.speedLimitUuid ?? null,
                portHoppingConfigUuid: null,
                externalPort,
                internalAddress: dto.internalAddress,
                internalPort: dto.internalPort,
                network: dto.network,
                enabled: dto.enabled,
                gostForwardId: routeUuid,
                gostServiceName: `user-route-${routeUuid}-${dto.network}`,
            });

            try {
                if (dto.portHoppingConfigUuid) {
                    await this.portRangeAllocator.allocate(route.uuid, dto.portHoppingConfigUuid);
                }
            } catch (error) {
                await this.repository.delete(route.uuid).catch(() => void 0);
                return fail({
                    code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                    message: `Unable to allocate a Hysteria2 hopping range: ${String(error)}`,
                    httpCode: 400,
                });
            }

            const allocatedRoute = (await this.repository.findByUuid(route.uuid)) ?? route;

            const runtime = await this.syncNode(dto.nodeUuid);
            if (!runtime.isOk || !runtime.response.applied) {
                await this.repository.delete(route.uuid).catch(async (cleanupError) => {
                    this.logger.error(`Failed to clean up unsynced user route: ${cleanupError}`);
                    await this.repository
                        .update(route.uuid, { enabled: false })
                        .catch((disableError) =>
                            this.logger.error(
                                `Failed to disable unsynced user route: ${disableError}`,
                            ),
                        );
                });
                return fail(
                    ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                        runtime.isOk
                            ? (runtime.response.error ?? 'GOST rejected the route')
                            : (runtime.message ?? 'Node runtime sync failed'),
                    ),
                );
            }

            return ok(allocatedRoute);
        } catch (error) {
            this.logger.error(error);
            if (this.isUniqueViolation(error)) return fail(ERRORS.USER_ROUTE_PORT_ALREADY_EXISTS);
            return fail(ERRORS.CREATE_USER_ROUTE_ERROR);
        }
    }

    async update(dto: UpdateUserRouteBodyDto): Promise<TResult<UserRouteEntity>> {
        try {
            const existing = await this.repository.findByUuid(dto.uuid);
            if (!existing) return fail(ERRORS.USER_ROUTE_NOT_FOUND);

            const nextNetwork = dto.network ?? existing.network;
            const nextInternalAddress = dto.internalAddress ?? existing.internalAddress;

            if (!['127.0.0.1', '::1'].includes(nextInternalAddress)) {
                return fail({
                    code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                    message: 'GOST user routes must target a loopback proxy-core listener',
                    httpCode: 400,
                });
            }

            if (dto.speedLimitUuid !== undefined && dto.speedLimitUuid !== null) {
                const speedLimit = await this.prisma.speedLimits.findUnique({
                    where: { uuid: dto.speedLimitUuid },
                    select: { uuid: true },
                });
                if (!speedLimit) return fail(ERRORS.SPEED_LIMIT_NOT_FOUND);
            }

            if (dto.portHoppingConfigUuid) {
                const hopping = await this.validatePortHoppingConfig(
                    dto.portHoppingConfigUuid,
                    existing.configProfileInboundUuid,
                );
                if (!hopping.isOk) return hopping;
            }

            if (dto.internalPort !== undefined && dto.internalPort !== existing.internalPort) {
                const inbound = await this.prisma.configProfileInbounds.findUnique({
                    where: { uuid: existing.configProfileInboundUuid },
                    select: { port: true, rawInbound: true },
                });
                if (!inbound || inbound.port === null || dto.internalPort !== inbound.port) {
                    return fail({
                        code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                        message:
                            'GOST internal port must match the selected proxy-core inbound port',
                        httpCode: 400,
                    });
                }
            }

            if (dto.network !== undefined) {
                const inbound = await this.prisma.configProfileInbounds.findUnique({
                    where: { uuid: existing.configProfileInboundUuid },
                    select: { rawInbound: true },
                });
                if (!inbound || dto.network !== this.resolveInboundNetwork(inbound.rawInbound)) {
                    return fail({
                        code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                        message: 'GOST route network must match the selected proxy-core inbound',
                        httpCode: 400,
                    });
                }
            }

            const nextExternalPort = dto.externalPort ?? existing.externalPort;
            if (dto.externalPort !== undefined || dto.network !== undefined) {
                const reserved = await this.repository.listPorts(existing.nodeUuid, nextNetwork);
                const isCurrentRoutePort =
                    nextNetwork === existing.network && nextExternalPort === existing.externalPort;
                if (!isCurrentRoutePort && reserved.includes(nextExternalPort)) {
                    return fail(ERRORS.USER_ROUTE_PORT_ALREADY_EXISTS);
                }
                if (
                    !isCurrentRoutePort &&
                    (
                        await this.portRangeAllocator.detectConflict(
                            existing.nodeUuid,
                            nextExternalPort,
                            nextExternalPort,
                            existing.uuid,
                        )
                    ).length > 0
                ) {
                    return fail(ERRORS.USER_ROUTE_PORT_ALREADY_EXISTS);
                }
            }

            const data: Prisma.UserRoutesUncheckedUpdateInput = {
                ...(dto.speedLimitUuid === undefined ? {} : { speedLimitUuid: dto.speedLimitUuid }),
                ...(dto.externalPort === undefined ? {} : { externalPort: dto.externalPort }),
                ...(dto.internalAddress === undefined
                    ? {}
                    : { internalAddress: dto.internalAddress }),
                ...(dto.internalPort === undefined ? {} : { internalPort: dto.internalPort }),
                ...(dto.network === undefined ? {} : { network: dto.network }),
                ...(dto.network === undefined
                    ? {}
                    : { gostServiceName: `user-route-${existing.uuid}-${dto.network}` }),
                ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
            };
            await this.repository.update(dto.uuid, data);

            try {
                if (dto.portHoppingConfigUuid !== undefined) {
                    await this.portRangeAllocator.release(dto.uuid);
                    if (dto.portHoppingConfigUuid !== null) {
                        await this.portRangeAllocator.allocate(dto.uuid, dto.portHoppingConfigUuid);
                    }
                }
            } catch (error) {
                await this.restoreRoute(existing);
                return fail({
                    code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                    message: `Unable to update the Hysteria2 hopping allocation: ${String(error)}`,
                    httpCode: 400,
                });
            }

            const result = await this.repository.findByUuid(dto.uuid);
            if (!result) return fail(ERRORS.USER_ROUTE_NOT_FOUND);

            const runtime = await this.syncNode(existing.nodeUuid);
            if (!runtime.isOk || !runtime.response.applied) {
                await this.restoreRoute(existing);
                await this.syncNode(existing.nodeUuid).catch(() => void 0);
                return fail(
                    ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                        runtime.isOk
                            ? (runtime.response.error ?? 'GOST rejected the route')
                            : (runtime.message ?? 'Node runtime sync failed'),
                    ),
                );
            }

            return ok(result);
        } catch (error) {
            this.logger.error(error);
            if (this.isUniqueViolation(error)) return fail(ERRORS.USER_ROUTE_PORT_ALREADY_EXISTS);
            return fail(ERRORS.UPDATE_USER_ROUTE_ERROR);
        }
    }

    async delete(uuid: string): Promise<TResult<boolean>> {
        try {
            const existing = await this.repository.findByUuid(uuid);
            if (!existing) return fail(ERRORS.USER_ROUTE_NOT_FOUND);

            const runtime = await this.syncNode(existing.nodeUuid, uuid);
            if (!runtime.isOk || !runtime.response.applied) {
                return fail(
                    ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                        runtime.isOk
                            ? (runtime.response.error ?? 'GOST rejected the route deletion')
                            : (runtime.message ?? 'Node runtime sync failed'),
                    ),
                );
            }

            try {
                await this.repository.delete(uuid);
            } catch (error) {
                await this.syncNode(existing.nodeUuid).catch(() => void 0);
                throw error;
            }
            return ok(true);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.DELETE_USER_ROUTE_ERROR);
        }
    }

    async reallocatePort(uuid: string): Promise<TResult<UserRouteEntity>> {
        const existing = await this.repository.findByUuid(uuid);
        if (!existing) return fail(ERRORS.USER_ROUTE_NOT_FOUND);

        const externalPort = await this.allocatePort(existing.nodeUuid, existing.network);
        if (externalPort === null) return fail(ERRORS.USER_ROUTE_PORT_ALREADY_EXISTS);

        return this.update({ uuid, externalPort });
    }

    public async reconcileNode(nodeUuid: string) {
        return this.syncNode(nodeUuid);
    }

    private async validateReferences(dto: CreateUserRouteBodyDto): Promise<TResult<true>> {
        const [user, node, inbound, host, speedLimit, nodeInbound] = await Promise.all([
            this.prisma.users.findUnique({
                where: { id: BigInt(dto.userId) },
                select: { id: true },
            }),
            this.prisma.nodes.findUnique({ where: { uuid: dto.nodeUuid }, select: { uuid: true } }),
            this.prisma.configProfileInbounds.findUnique({
                where: { uuid: dto.configProfileInboundUuid },
                select: { uuid: true, profileUuid: true, port: true, rawInbound: true },
            }),
            this.prisma.hosts.findUnique({
                where: { uuid: dto.hostUuid },
                select: {
                    uuid: true,
                    configProfileUuid: true,
                    configProfileInboundUuid: true,
                    nodes: { select: { nodeUuid: true } },
                },
            }),
            dto.speedLimitUuid
                ? this.prisma.speedLimits.findUnique({
                      where: { uuid: dto.speedLimitUuid },
                      select: { uuid: true },
                  })
                : Promise.resolve({ uuid: null }),
            this.prisma.configProfileInboundsToNodes.findUnique({
                where: {
                    configProfileInboundUuid_nodeUuid: {
                        configProfileInboundUuid: dto.configProfileInboundUuid,
                        nodeUuid: dto.nodeUuid,
                    },
                },
                select: { configProfileInboundUuid: true },
            }),
        ]);

        if (!user || !node || !inbound || !host || !nodeInbound) {
            return fail(ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND);
        }
        if (
            !isHostCompatibleWithUserRoute(
                {
                    configProfileUuid: host.configProfileUuid,
                    configProfileInboundUuid: host.configProfileInboundUuid,
                    nodeUuids: host.nodes.map(({ nodeUuid }) => nodeUuid),
                },
                dto.nodeUuid,
                inbound,
            )
        ) {
            return fail(ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND);
        }
        if (dto.speedLimitUuid && !speedLimit) {
            return fail(ERRORS.SPEED_LIMIT_NOT_FOUND);
        }
        if (dto.portHoppingConfigUuid) {
            const hopping = await this.validatePortHoppingConfig(
                dto.portHoppingConfigUuid,
                inbound.uuid,
            );
            if (!hopping.isOk) return hopping;
        }
        if (!['127.0.0.1', '::1'].includes(dto.internalAddress)) {
            return fail({
                code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                message: 'GOST user routes must target a loopback proxy-core listener',
                httpCode: 400,
            });
        }
        if (inbound.port === null || dto.internalPort !== inbound.port) {
            return fail({
                code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                message: 'GOST internal port must match the selected proxy-core inbound port',
                httpCode: 400,
            });
        }

        const rawInbound = inbound.rawInbound as { listen?: unknown } | null;
        if (
            !rawInbound ||
            typeof rawInbound.listen !== 'string' ||
            !['127.0.0.1', '::1'].includes(rawInbound.listen)
        ) {
            return fail({
                code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                message:
                    'Selected proxy-core inbound is not in GOST limiter mode: its listen address must explicitly be 127.0.0.1 or ::1',
                httpCode: 400,
            });
        }
        if (dto.network !== this.resolveInboundNetwork(inbound.rawInbound)) {
            return fail({
                code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                message: 'GOST route network must match the selected proxy-core inbound',
                httpCode: 400,
            });
        }
        return ok(true);
    }

    private resolveInboundNetwork(rawInbound: unknown): 'tcp' | 'udp' {
        if (!rawInbound || typeof rawInbound !== 'object' || Array.isArray(rawInbound))
            return 'tcp';

        const inbound = rawInbound as {
            protocol?: unknown;
            type?: unknown;
            streamSettings?: { network?: unknown };
        };
        if (inbound.protocol === 'hysteria' || inbound.type === 'hysteria2') return 'udp';

        const network = inbound.streamSettings?.network;
        return network === 'hysteria' || network === 'quic' ? 'udp' : 'tcp';
    }

    private async validatePortHoppingConfig(
        configUuid: string,
        inboundUuid: string,
    ): Promise<TResult<true>> {
        const config = await this.prisma.portHoppingConfigs.findUnique({
            where: { uuid: configUuid },
            include: {
                configProfileInbound: {
                    select: {
                        uuid: true,
                        rawInbound: true,
                        profile: { select: { coreType: true } },
                    },
                },
            },
        });
        const rawInbound = config?.configProfileInbound.rawInbound as { type?: unknown } | null;
        if (
            !config ||
            !config.enabled ||
            config.configProfileInbound.uuid !== inboundUuid ||
            config.configProfileInbound.profile.coreType !== 'singbox' ||
            rawInbound?.type !== 'hysteria2'
        ) {
            return fail({
                code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
                message:
                    'Port hopping requires an enabled config for the selected sing-box Hysteria2 inbound',
                httpCode: 400,
            });
        }
        return ok(true);
    }

    private async restoreRoute(route: UserRouteEntity): Promise<void> {
        await this.repository.update(route.uuid, {
            speedLimitUuid: route.speedLimitUuid,
            portHoppingConfigUuid: route.portHoppingConfigUuid,
            externalPort: route.externalPort,
            internalAddress: route.internalAddress,
            internalPort: route.internalPort,
            network: route.network,
            enabled: route.enabled,
            hopStartPort: route.hopStartPort,
            hopEndPort: route.hopEndPort,
            gostServiceName: route.gostServiceName,
        });
    }

    private async allocatePort(nodeUuid: string, network: string): Promise<number | null> {
        const used = new Set(await this.repository.listPorts(nodeUuid, network));
        for (let port = DEFAULT_PORT_START; port <= DEFAULT_PORT_END; port += 1) {
            if (!used.has(port)) return port;
        }
        return null;
    }

    private isUniqueViolation(error: unknown): boolean {
        return (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code?: string }).code === 'P2002'
        );
    }

    private async syncNode(nodeUuid: string, excludeRouteUuid?: string) {
        const node = await this.nodesRepository.findByUUID(nodeUuid);
        if (!node || !node.port) {
            return fail(
                ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                    `Node ${nodeUuid} is not connected or has no API port`,
                ),
            );
        }

        const routes = (await this.repository.findRuntimeByNodeUuid(nodeUuid)).filter(
            (route) => route.uuid !== excludeRouteUuid,
        );
        const restored = await this.portRangeAllocator.restoreDesiredState();
        const restoreIssue = restored.issues.find((issue) => issue.nodeUuid === nodeUuid);
        if (restoreIssue) {
            return fail(
                ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                    `Unsafe persisted port hopping allocation: ${restoreIssue.message}`,
                ),
            );
        }

        const runtime = await this.axiosService.syncGostForwards(
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
            { nodeUuid, address: node.address, port: node.port, proxyUrl: node.proxyUrl },
        );

        if (!runtime.isOk || !runtime.response.applied) {
            this.logger.error({
                message: 'User route GOST synchronization failed',
                nodeUuid,
                requestPath: GOST_NODE_API.syncForwards,
                errorCode: ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.code,
                tlsInitializationStatus: this.axiosService.getNodeTransportInitializationStatus(),
            });
        }

        if (!runtime.isOk) return runtime;
        if (!runtime.response.applied) {
            return fail(
                ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                    runtime.response.error ?? 'GOST rejected the configuration',
                ),
            );
        }

        const requiresPortHopping = routes.some(
            (route) =>
                route.enabled &&
                route.portHoppingConfig?.enabled &&
                route.hopStartPort !== null &&
                route.hopEndPort !== null,
        );
        if (requiresPortHopping && !runtime.response.portHopping.applied) {
            return fail(
                ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                    runtime.response.portHopping.error ??
                        'Port hopping ingress did not apply; canonical GOST routes remain available',
                ),
            );
        }

        return runtime;
    }
}
