import { Prisma } from '@prisma/client';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';

import { SpeedLimitEntity } from '../entities';
import { SpeedLimitsConverter } from '../speed-limits.converter';

@Injectable()
export class SpeedLimitsRepository {
    constructor(
        private readonly prisma: PrismaService,
        private readonly converter: SpeedLimitsConverter,
    ) {}

    async findAll(): Promise<SpeedLimitEntity[]> {
        const result = await this.prisma.speedLimits.findMany({ orderBy: { name: 'asc' } });
        return this.converter.fromPrismaModelsToEntities(result);
    }

    async findByUuid(uuid: string): Promise<SpeedLimitEntity | null> {
        const result = await this.prisma.speedLimits.findUnique({ where: { uuid } });
        return result ? this.converter.fromPrismaModelToEntity(result) : null;
    }

    async create(data: {
        name: string;
        downloadBytesPerSecond: bigint;
        uploadBytesPerSecond: bigint;
        enabled: boolean;
    }): Promise<SpeedLimitEntity> {
        const result = await this.prisma.speedLimits.create({ data });
        return this.converter.fromPrismaModelToEntity(result);
    }

    async update(
        uuid: string,
        data: Prisma.SpeedLimitsUpdateInput,
    ): Promise<SpeedLimitEntity> {
        const result = await this.prisma.speedLimits.update({ where: { uuid }, data });
        return this.converter.fromPrismaModelToEntity(result);
    }

    async delete(uuid: string): Promise<void> {
        await this.prisma.speedLimits.delete({ where: { uuid } });
    }
}
