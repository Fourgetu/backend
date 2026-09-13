import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AxiosModule } from '@common/axios';

import { NodesModule } from '@modules/nodes/nodes.module';
import { SpeedLimitsModule } from '@modules/speed-limits/speed-limits.module';

import { PortHoppingConfigsService } from './port-hopping-configs.service';
import { PortRangeAllocator } from './port-range-allocator.service';
import { UserRoutesRepository } from './repositories';
import { UserRoutesController } from './user-routes.controller';
import { UserRoutesConverter } from './user-routes.converter';
import { UserRoutesService } from './user-routes.service';

@Module({
    imports: [AxiosModule, CqrsModule, SpeedLimitsModule, NodesModule],
    controllers: [UserRoutesController],
    providers: [
        PortHoppingConfigsService,
        PortRangeAllocator,
        UserRoutesConverter,
        UserRoutesRepository,
        UserRoutesService,
    ],
    exports: [PortRangeAllocator],
})
export class UserRoutesModule {}
