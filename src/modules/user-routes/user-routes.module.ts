import { Module } from '@nestjs/common';

import { SpeedLimitsModule } from '@modules/speed-limits/speed-limits.module';
import { NodesModule } from '@modules/nodes/nodes.module';

import { UserRoutesController } from './user-routes.controller';
import { UserRoutesConverter } from './user-routes.converter';
import { UserRoutesRepository } from './repositories';
import { UserRoutesService } from './user-routes.service';
import { PortRangeAllocator } from './port-range-allocator.service';
import { PortHoppingConfigsService } from './port-hopping-configs.service';

@Module({
    imports: [SpeedLimitsModule, NodesModule],
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
