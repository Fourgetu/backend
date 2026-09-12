import { Module } from '@nestjs/common';

import { NodesModule } from '@modules/nodes/nodes.module';

import { SpeedLimitsController } from './speed-limits.controller';
import { SpeedLimitsConverter } from './speed-limits.converter';
import { SpeedLimitsRepository } from './repositories/speed-limits.repository';
import { SpeedLimitsService } from './speed-limits.service';

@Module({
    imports: [NodesModule],
    controllers: [SpeedLimitsController],
    providers: [SpeedLimitsConverter, SpeedLimitsRepository, SpeedLimitsService],
    exports: [SpeedLimitsService],
})
export class SpeedLimitsModule {}
