import { UserRoutes } from '@prisma/client';

import { Injectable } from '@nestjs/common';

import { UserRouteEntity } from './entities';

@Injectable()
export class UserRoutesConverter {
    fromPrismaModelToEntity(model: UserRoutes): UserRouteEntity {
        return new UserRouteEntity({
            uuid: model.uuid,
            userId: Number(model.userId),
            nodeUuid: model.nodeUuid,
            configProfileInboundUuid: model.configProfileInboundUuid,
            hostUuid: model.hostUuid,
            speedLimitUuid: model.speedLimitUuid,
            portHoppingConfigUuid: model.portHoppingConfigUuid,
            externalPort: model.externalPort,
            internalAddress: model.internalAddress,
            internalPort: model.internalPort,
            gostForwardId: model.gostForwardId,
            gostServiceName: model.gostServiceName,
            network: model.network,
            enabled: model.enabled,
            hopStartPort: model.hopStartPort,
            hopEndPort: model.hopEndPort,
            createdAt: model.createdAt,
            updatedAt: model.updatedAt,
        });
    }

    fromPrismaModelsToEntities(models: UserRoutes[]): UserRouteEntity[] {
        return models.map((model) => this.fromPrismaModelToEntity(model));
    }
}
