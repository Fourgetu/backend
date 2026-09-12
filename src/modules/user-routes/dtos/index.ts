import { createZodDto } from 'nestjs-zod';

import {
    CreateUserRouteCommand,
    DeleteUserRouteCommand,
    GetUserRouteRuntimeStatusCommand,
    ReallocateUserRoutePortCommand,
    GetUserRoutesCommand,
    UpdateUserRouteCommand,
    CreatePortHoppingConfigCommand,
    DeletePortHoppingConfigCommand,
    GetPortHoppingConfigsCommand,
    UpdatePortHoppingConfigCommand,
} from '@libs/contracts/commands';

export class GetUserRoutesResponseDto extends createZodDto(GetUserRoutesCommand.ResponseSchema) {}

export class CreateUserRouteResponseDto extends createZodDto(
    CreateUserRouteCommand.ResponseSchema,
) {}

export class UpdateUserRouteResponseDto extends createZodDto(
    UpdateUserRouteCommand.ResponseSchema,
) {}

export class CreateUserRouteBodyDto extends createZodDto(
    CreateUserRouteCommand.RequestBodySchema,
) {}

export class UpdateUserRouteBodyDto extends createZodDto(
    UpdateUserRouteCommand.RequestBodySchema,
) {}

export class GetUserRoutesQueryDto extends createZodDto(GetUserRoutesCommand.RequestQuerySchema) {}

export class DeleteUserRouteParamDto extends createZodDto(
    DeleteUserRouteCommand.RequestParamSchema,
) {}

export class GetUserRouteRuntimeStatusParamDto extends createZodDto(
    GetUserRouteRuntimeStatusCommand.RequestParamSchema,
) {}

export class GetUserRouteRuntimeStatusResponseDto extends createZodDto(
    GetUserRouteRuntimeStatusCommand.ResponseSchema,
) {}

export class ReallocateUserRoutePortParamDto extends createZodDto(
    ReallocateUserRoutePortCommand.RequestParamSchema,
) {}

export class ReallocateUserRoutePortResponseDto extends createZodDto(
    ReallocateUserRoutePortCommand.ResponseSchema,
) {}

export class GetPortHoppingConfigsQueryDto extends createZodDto(
    GetPortHoppingConfigsCommand.RequestQuerySchema,
) {}
export class GetPortHoppingConfigsResponseDto extends createZodDto(
    GetPortHoppingConfigsCommand.ResponseSchema,
) {}
export class CreatePortHoppingConfigBodyDto extends createZodDto(
    CreatePortHoppingConfigCommand.RequestBodySchema,
) {}
export class CreatePortHoppingConfigResponseDto extends createZodDto(
    CreatePortHoppingConfigCommand.ResponseSchema,
) {}
export class UpdatePortHoppingConfigParamDto extends createZodDto(
    UpdatePortHoppingConfigCommand.RequestParamSchema,
) {}
export class UpdatePortHoppingConfigBodyDto extends createZodDto(
    UpdatePortHoppingConfigCommand.RequestBodySchema,
) {}
export class UpdatePortHoppingConfigResponseDto extends createZodDto(
    UpdatePortHoppingConfigCommand.ResponseSchema,
) {}
export class DeletePortHoppingConfigParamDto extends createZodDto(
    DeletePortHoppingConfigCommand.RequestParamSchema,
) {}
