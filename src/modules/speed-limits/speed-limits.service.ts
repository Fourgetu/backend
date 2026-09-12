import { Injectable, Logger } from '@nestjs/common';

import { AxiosService } from '@common/axios';
import { PrismaService } from '@common/database/prisma.service';
import { fail, ok, TResult } from '@common/types';
import { normalizeSpeedBytesPerSecond } from '@common/utils/speed-limit';
import { ERRORS } from '@libs/contracts/constants';

import { NodesRepository } from '@modules/nodes/repositories/nodes.repository';

import { CreateSpeedLimitBodyDto, UpdateSpeedLimitBodyDto } from './dtos';
import { SpeedLimitEntity } from './entities';
import { SpeedLimitsRepository } from './repositories/speed-limits.repository';

@Injectable()
export class SpeedLimitsService {
    private readonly logger = new Logger(SpeedLimitsService.name);

    constructor(
        private readonly repository: SpeedLimitsRepository,
        private readonly prisma: PrismaService,
        private readonly axiosService: AxiosService,
        private readonly nodesRepository: NodesRepository,
    ) {}

    async getAll(): Promise<TResult<SpeedLimitEntity[]>> {
        try {
            return ok(await this.repository.findAll());
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_SPEED_LIMITS_ERROR);
        }
    }

    async create(dto: CreateSpeedLimitBodyDto): Promise<TResult<SpeedLimitEntity>> {
        try {
            const result = await this.repository.create({
                name: dto.name,
                downloadBytesPerSecond: normalizeSpeedBytesPerSecond(dto.downloadBytesPerSecond),
                uploadBytesPerSecond: normalizeSpeedBytesPerSecond(dto.uploadBytesPerSecond),
                enabled: dto.enabled,
            });
            return ok(result);
        } catch (error) {
            this.logger.error(error);
            if (this.isUniqueViolation(error)) return fail(ERRORS.SPEED_LIMIT_NAME_ALREADY_EXISTS);
            return fail(ERRORS.CREATE_SPEED_LIMIT_ERROR);
        }
    }

    async update(dto: UpdateSpeedLimitBodyDto): Promise<TResult<SpeedLimitEntity>> {
        try {
            const existing = await this.repository.findByUuid(dto.uuid);
            if (!existing) return fail(ERRORS.SPEED_LIMIT_NOT_FOUND);

            const result = await this.repository.update(dto.uuid, {
                ...(dto.name === undefined ? {} : { name: dto.name }),
                ...(dto.downloadBytesPerSecond === undefined
                    ? {}
                    : {
                          downloadBytesPerSecond: normalizeSpeedBytesPerSecond(
                              dto.downloadBytesPerSecond,
                          ),
                      }),
                ...(dto.uploadBytesPerSecond === undefined
                    ? {}
                    : {
                          uploadBytesPerSecond: normalizeSpeedBytesPerSecond(
                              dto.uploadBytesPerSecond,
                          ),
                      }),
                ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
            });

            const runtime = await this.syncSpeedLimitRoutes(dto.uuid);
            if (!runtime.isOk) {
                await this.repository.update(dto.uuid, {
                    name: existing.name,
                    downloadBytesPerSecond: BigInt(existing.downloadBytesPerSecond),
                    uploadBytesPerSecond: BigInt(existing.uploadBytesPerSecond),
                    enabled: existing.enabled,
                });
                await this.syncSpeedLimitRoutes(dto.uuid).catch(() => void 0);
                return runtime;
            }

            return ok(result);
        } catch (error) {
            this.logger.error(error);
            if (this.isUniqueViolation(error)) return fail(ERRORS.SPEED_LIMIT_NAME_ALREADY_EXISTS);
            return fail(ERRORS.UPDATE_SPEED_LIMIT_ERROR);
        }
    }

    async delete(uuid: string): Promise<TResult<boolean>> {
        try {
            const existing = await this.repository.findByUuid(uuid);
            if (!existing) return fail(ERRORS.SPEED_LIMIT_NOT_FOUND);

            const affectedNodeUuids = await this.prisma.userRoutes.findMany({
                where: { speedLimitUuid: uuid },
                select: { nodeUuid: true },
                distinct: ['nodeUuid'],
            });

            const preparedNodeUuids: string[] = [];
            for (const { nodeUuid } of affectedNodeUuids) {
                const runtime = await this.syncNode(nodeUuid, {
                    uuid,
                    downloadBytesPerSecond: 0,
                    uploadBytesPerSecond: 0,
                    enabled: false,
                });
                if (!runtime.isOk) {
                    await Promise.all(
                        preparedNodeUuids.map((preparedNodeUuid) =>
                            this.syncNode(preparedNodeUuid).catch(() => void 0),
                        ),
                    );
                    return runtime;
                }
                preparedNodeUuids.push(nodeUuid);
            }

            try {
                await this.repository.delete(uuid);
            } catch (error) {
                await Promise.all(
                    preparedNodeUuids.map((nodeUuid) =>
                        this.syncNode(nodeUuid).catch(() => void 0),
                    ),
                );
                throw error;
            }
            return ok(true);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.DELETE_SPEED_LIMIT_ERROR);
        }
    }

    private isUniqueViolation(error: unknown): boolean {
        return (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code?: string }).code === 'P2002'
        );
    }

    private async syncSpeedLimitRoutes(speedLimitUuid: string): Promise<TResult<true>> {
        const affectedNodeUuids = await this.prisma.userRoutes.findMany({
            where: { speedLimitUuid },
            select: { nodeUuid: true },
            distinct: ['nodeUuid'],
        });

        for (const { nodeUuid } of affectedNodeUuids) {
            const result = await this.syncNode(nodeUuid);
            if (!result.isOk) return result;
        }

        return ok(true);
    }

    private async syncNode(
        nodeUuid: string,
        speedLimitOverride?: {
            uuid: string;
            downloadBytesPerSecond: number;
            uploadBytesPerSecond: number;
            enabled: boolean;
        },
    ): Promise<TResult<true>> {
        const node = await this.nodesRepository.findByUUID(nodeUuid);
        if (!node || !node.port) {
            return fail(
                ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                    `Node ${nodeUuid} is not connected or has no API port`,
                ),
            );
        }

        const routes = await this.prisma.userRoutes.findMany({
            where: { nodeUuid },
            include: {
                speedLimit: {
                    select: {
                        downloadBytesPerSecond: true,
                        uploadBytesPerSecond: true,
                        enabled: true,
                    },
                },
            },
        });

        const runtime = await this.axiosService.syncGostForwards(
            {
                forwards: routes.map((route) => {
                    const speedLimit =
                        speedLimitOverride && route.speedLimitUuid === speedLimitOverride.uuid
                            ? speedLimitOverride
                            : route.speedLimit;

                    return {
                        id: route.uuid,
                        externalPort: route.externalPort,
                        internalAddress: route.internalAddress as '127.0.0.1' | '::1',
                        internalPort: route.internalPort,
                        network: route.network as 'tcp' | 'udp',
                        downloadBytesPerSecond:
                            speedLimit?.enabled && speedLimit.downloadBytesPerSecond
                                ? Number(speedLimit.downloadBytesPerSecond)
                                : 0,
                        uploadBytesPerSecond:
                            speedLimit?.enabled && speedLimit.uploadBytesPerSecond
                                ? Number(speedLimit.uploadBytesPerSecond)
                                : 0,
                        enabled: route.enabled,
                    };
                }),
            },
            { address: node.address, port: node.port, proxyUrl: node.proxyUrl },
        );

        if (!runtime.isOk) return runtime;
        if (!runtime.response.applied) {
            return fail(
                ERRORS.USER_ROUTE_RUNTIME_SYNC_FAILED.withMessage(
                    runtime.response.error ?? 'GOST rejected the configuration',
                ),
            );
        }

        return ok(true);
    }
}
