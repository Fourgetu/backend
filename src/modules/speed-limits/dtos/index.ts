import { createZodDto } from 'nestjs-zod';

import {
    CreateSpeedLimitCommand,
    DeleteSpeedLimitCommand,
    GetSpeedLimitsCommand,
    UpdateSpeedLimitCommand,
} from '@libs/contracts/commands';

export class GetSpeedLimitsResponseDto extends createZodDto(
    GetSpeedLimitsCommand.ResponseSchema,
) {}

export class CreateSpeedLimitResponseDto extends createZodDto(
    CreateSpeedLimitCommand.ResponseSchema,
) {}

export class UpdateSpeedLimitResponseDto extends createZodDto(
    UpdateSpeedLimitCommand.ResponseSchema,
) {}

export class CreateSpeedLimitBodyDto extends createZodDto(
    CreateSpeedLimitCommand.RequestBodySchema,
) {}

export class UpdateSpeedLimitBodyDto extends createZodDto(
    UpdateSpeedLimitCommand.RequestBodySchema,
) {}

export class DeleteSpeedLimitParamDto extends createZodDto(
    DeleteSpeedLimitCommand.RequestParamSchema,
) {}
