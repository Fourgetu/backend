import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AxiosModule } from '@common/axios';

import { NodesModule } from '@modules/nodes/nodes.module';

import { SpeedLimitsRepository } from './repositories/speed-limits.repository';
import { SpeedLimitsController } from './speed-limits.controller';
import { SpeedLimitsConverter } from './speed-limits.converter';
import { SpeedLimitsService } from './speed-limits.service';

@Module({
    imports: [AxiosModule, CqrsModule, NodesModule],
    controllers: [SpeedLimitsController],
    providers: [SpeedLimitsConverter, SpeedLimitsRepository, SpeedLimitsService],
    exports: [SpeedLimitsService],
})
export class SpeedLimitsModule {}
