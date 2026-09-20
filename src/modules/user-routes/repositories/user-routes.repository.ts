import { Prisma } from '@prisma/client';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';

import { UserRouteEntity } from '../entities';
import { UserRoutesConverter } from '../user-routes.converter';

@Injectable()
export class UserRoutesRepository {
    constructor(
        private readonly prisma: PrismaService,
        private readonly converter: UserRoutesConverter,
    ) {}

    async findAll(filters: { userId?: number; nodeUuid?: string }): Promise<UserRouteEntity[]> {
        const result = await this.prisma.userRoutes.findMany({
            where: {
                ...(filters.userId === undefined ? {} : { userId: BigInt(filters.userId) }),
                ...(filters.nodeUuid === undefined ? {} : { nodeUuid: filters.nodeUuid }),
            },
            orderBy: [{ nodeUuid: 'asc' }, { externalPort: 'asc' }],
        });
        return this.converter.fromPrismaModelsToEntities(result);
    }

    async findByUuid(uuid: string): Promise<UserRouteEntity | null> {
        const result = await this.prisma.userRoutes.findUnique({ where: { uuid } });
        return result ? this.converter.fromPrismaModelToEntity(result) : null;
    }

    async hasOverlappingRoute(
        route: {
            nodeUuid: string;
            userId: number | bigint;
            configProfileInboundUuid: string;
            hostUuid: string;
            network: string;
        },
        excludeUuid?: string,
    ): Promise<boolean> {
        return Boolean(
            await this.prisma.userRoutes.findFirst({
                where: {
                    nodeUuid: route.nodeUuid,
                    userId: BigInt(route.userId),
                    configProfileInboundUuid: route.configProfileInboundUuid,
                    hostUuid: route.hostUuid,
                    network: {
                        in:
                            route.network === 'tcp,udp'
                                ? ['tcp', 'udp', 'tcp,udp']
                                : [route.network, 'tcp,udp'],
                    },
                    ...(excludeUuid ? { uuid: { not: excludeUuid } } : {}),
                },
                select: { uuid: true },
            }),
        );
    }

    async create(data: Prisma.UserRoutesUncheckedCreateInput): Promise<UserRouteEntity> {
        const result = await this.prisma.userRoutes.create({ data });
        return this.converter.fromPrismaModelToEntity(result);
    }

    async update(
        uuid: string,
        data: Prisma.UserRoutesUncheckedUpdateInput,
    ): Promise<UserRouteEntity> {
        const result = await this.prisma.userRoutes.update({ where: { uuid }, data });
        return this.converter.fromPrismaModelToEntity(result);
    }

    async delete(uuid: string): Promise<void> {
        await this.prisma.userRoutes.delete({ where: { uuid } });
    }

    async findRuntimeByNodeUuid(nodeUuid: string) {
        return this.prisma.userRoutes.findMany({
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
                    select: { enabled: true, hopIntervalSeconds: true },
                },
            },
            orderBy: [{ externalPort: 'asc' }, { network: 'asc' }],
        });
    }

    async listPorts(nodeUuid: string, network: string): Promise<number[]> {
        const [routes, hosts, inbounds] = await Promise.all([
            this.prisma.userRoutes.findMany({
                where: {
                    nodeUuid,
                    network: {
                        in:
                            network === 'tcp,udp'
                                ? ['tcp', 'udp', 'tcp,udp']
                                : [network, 'tcp,udp'],
                    },
                },
                select: { externalPort: true },
            }),
            this.prisma.hostsToNodes.findMany({
                where: { nodeUuid },
                select: { host: { select: { port: true } } },
            }),
            this.prisma.configProfileInboundsToNodes.findMany({
                where: { nodeUuid },
                select: { configProfileInbounds: { select: { port: true } } },
            }),
        ]);

        return [
            ...routes.map((route) => route.externalPort),
            ...hosts.map(({ host }) => host.port),
            ...inbounds.flatMap(({ configProfileInbounds }) =>
                configProfileInbounds.port === null ? [] : [configProfileInbounds.port],
            ),
        ];
    }
}
