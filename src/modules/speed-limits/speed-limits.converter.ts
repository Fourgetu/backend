import { SpeedLimits } from '@prisma/client';

import { Injectable } from '@nestjs/common';

import { SpeedLimitEntity } from './entities/speed-limit.entity';

@Injectable()
export class SpeedLimitsConverter {
    fromPrismaModelToEntity(model: SpeedLimits): SpeedLimitEntity {
        return new SpeedLimitEntity({
            uuid: model.uuid,
            name: model.name,
            downloadBytesPerSecond: Number(model.downloadBytesPerSecond),
            uploadBytesPerSecond: Number(model.uploadBytesPerSecond),
            enabled: model.enabled,
            createdAt: model.createdAt,
            updatedAt: model.updatedAt,
        });
    }

    fromPrismaModelsToEntities(models: SpeedLimits[]): SpeedLimitEntity[] {
        return models.map((model) => this.fromPrismaModelToEntity(model));
    }
}
