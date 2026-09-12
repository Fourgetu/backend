import { PortHoppingConfigs, Prisma } from '@prisma/client';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';
import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import {
    CreatePortHoppingConfigBodyDto,
    GetPortHoppingConfigsQueryDto,
    UpdatePortHoppingConfigBodyDto,
} from './dtos';
import { PortRangeAllocator } from './port-range-allocator.service';
import { UserRoutesService } from './user-routes.service';

@Injectable()
export class PortHoppingConfigsService {
    private readonly logger = new Logger(PortHoppingConfigsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly allocator: PortRangeAllocator,
        private readonly userRoutesService: UserRoutesService,
    ) {}

    async getAll(dto: GetPortHoppingConfigsQueryDto): Promise<TResult<PortHoppingConfigs[]>> {
        try {
            return ok(
                await this.prisma.portHoppingConfigs.findMany({
                    where: dto.configProfileInboundUuid
                        ? { configProfileInboundUuid: dto.configProfileInboundUuid }
                        : undefined,
                    orderBy: { createdAt: 'asc' },
                }),
            );
        } catch (error) {
            this.logger.error(error);
            return this.invalid('Unable to list Hysteria2 port hopping configs', 500);
        }
    }

    async create(dto: CreatePortHoppingConfigBodyDto): Promise<TResult<PortHoppingConfigs>> {
        try {
            const issue = await this.validateCandidate(dto);
            if (issue) return this.invalid(issue);

            return ok(await this.prisma.portHoppingConfigs.create({ data: dto }));
        } catch (error) {
            this.logger.error(error);
            if (this.isUniqueViolation(error)) {
                return this.invalid('This inbound already has a port hopping config');
            }
            return this.invalid('Unable to create Hysteria2 port hopping config', 500);
        }
    }

    async update(
        uuid: string,
        dto: UpdatePortHoppingConfigBodyDto,
    ): Promise<TResult<PortHoppingConfigs>> {
        const existing = await this.prisma.portHoppingConfigs.findUnique({
            where: { uuid },
            include: { userRoutes: true },
        });
        if (!existing) return this.invalid('Port hopping config not found', 404);

        const candidate = { ...existing, ...dto };
        const issue = await this.validateCandidate(candidate, uuid);
        if (issue) return this.invalid(issue);

        for (const route of existing.userRoutes) {
            if (
                route.hopStartPort === null ||
                route.hopEndPort === null ||
                route.hopStartPort < candidate.poolStart ||
                route.hopEndPort > candidate.poolEnd ||
                route.hopEndPort - route.hopStartPort + 1 !== candidate.portsPerUser
            ) {
                return this.invalid(
                    'The requested pool change would invalidate a stable user allocation; release or reallocate routes first',
                );
            }
        }

        try {
            const updated = await this.prisma.portHoppingConfigs.update({
                where: { uuid },
                data: dto,
            });
            const sync = await this.syncNodes(existing.userRoutes.map((route) => route.nodeUuid));
            if (sync) {
                await this.prisma.portHoppingConfigs.update({
                    where: { uuid },
                    data: this.snapshot(existing),
                });
                await this.syncNodes(existing.userRoutes.map((route) => route.nodeUuid));
                return this.invalid(sync, 502);
            }
            return ok(updated);
        } catch (error) {
            this.logger.error(error);
            return this.invalid('Unable to update Hysteria2 port hopping config', 500);
        }
    }

    async delete(uuid: string): Promise<TResult<boolean>> {
        const existing = await this.prisma.portHoppingConfigs.findUnique({
            where: { uuid },
            include: { userRoutes: true },
        });
        if (!existing) return this.invalid('Port hopping config not found', 404);

        const nodeUuids = existing.userRoutes.map((route) => route.nodeUuid);
        try {
            await this.prisma.portHoppingConfigs.update({
                where: { uuid },
                data: { enabled: false },
            });
            const sync = await this.syncNodes(nodeUuids);
            if (sync) {
                await this.prisma.portHoppingConfigs.update({
                    where: { uuid },
                    data: { enabled: existing.enabled },
                });
                await this.syncNodes(nodeUuids);
                return this.invalid(sync, 502);
            }

            await this.prisma.$transaction([
                this.prisma.userRoutes.updateMany({
                    where: { portHoppingConfigUuid: uuid },
                    data: {
                        portHoppingConfigUuid: null,
                        hopStartPort: null,
                        hopEndPort: null,
                    },
                }),
                this.prisma.portHoppingConfigs.delete({ where: { uuid } }),
            ]);
            return ok(true);
        } catch (error) {
            this.logger.error(error);
            await this.prisma.portHoppingConfigs
                .update({ where: { uuid }, data: { enabled: existing.enabled } })
                .catch(() => void 0);
            await this.syncNodes(nodeUuids);
            return this.invalid('Unable to delete Hysteria2 port hopping config', 500);
        }
    }

    private async validateCandidate(
        candidate: {
            configProfileInboundUuid: string;
            enabled: boolean;
            hopIntervalSeconds: number;
            poolEnd: number;
            poolStart: number;
            portsPerUser: number;
        },
        existingConfigUuid?: string,
    ): Promise<string | null> {
        const invalid = this.allocator.validate({ uuid: existingConfigUuid ?? '', ...candidate });
        if (invalid.length > 0) return `Invalid port hopping fields: ${invalid.join(', ')}`;

        const inbound = await this.prisma.configProfileInbounds.findUnique({
            where: { uuid: candidate.configProfileInboundUuid },
            include: {
                profile: { select: { coreType: true } },
                configProfileInboundsToNodes: { select: { nodeUuid: true } },
            },
        });
        const rawInbound = inbound?.rawInbound as { type?: unknown } | null;
        if (!inbound || inbound.profile.coreType !== 'singbox' || rawInbound?.type !== 'hysteria2') {
            return 'Port hopping is supported only for sing-box Hysteria2 inbounds';
        }

        const ownRoutes = existingConfigUuid
            ? await this.prisma.userRoutes.findMany({
                  where: { portHoppingConfigUuid: existingConfigUuid },
                  select: { uuid: true },
              })
            : [];
        const ownRouteUuids = new Set(ownRoutes.map((route) => route.uuid));
        for (const { nodeUuid } of inbound.configProfileInboundsToNodes) {
            const conflicts = (
                await this.allocator.detectConflict(
                    nodeUuid,
                    candidate.poolStart,
                    candidate.poolEnd,
                )
            ).filter(
                (conflict) =>
                    conflict.source !== 'hopping-allocation' ||
                    !ownRouteUuids.has(conflict.sourceUuid),
            );
            if (conflicts.length > 0) {
                const conflict = conflicts[0];
                return `Port pool conflicts with ${conflict.source} ${conflict.sourceUuid} on node ${nodeUuid}`;
            }
        }
        return null;
    }

    private async syncNodes(nodeUuids: string[]): Promise<string | null> {
        for (const nodeUuid of new Set(nodeUuids)) {
            const result = await this.userRoutesService.reconcileNode(nodeUuid);
            if (!result.isOk || !result.response.applied) {
                return result.isOk
                    ? (result.response.error ?? `Node ${nodeUuid} rejected GOST desired state`)
                    : (result.message ?? `Node ${nodeUuid} is unavailable`);
            }
        }
        return null;
    }

    private snapshot(config: PortHoppingConfigs): Prisma.PortHoppingConfigsUpdateInput {
        return {
            enabled: config.enabled,
            poolStart: config.poolStart,
            poolEnd: config.poolEnd,
            portsPerUser: config.portsPerUser,
            hopIntervalSeconds: config.hopIntervalSeconds,
        };
    }

    private invalid(message: string, httpCode = 400) {
        return fail({
            code: ERRORS.USER_ROUTE_REFERENCE_NOT_FOUND.code,
            message,
            httpCode,
        });
    }

    private isUniqueViolation(error: unknown): boolean {
        return (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code?: string }).code === 'P2002'
        );
    }
}
