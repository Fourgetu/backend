import { Body, Controller, HttpStatus, Param, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles/roles.guard';
import { ScopesGuard } from '@common/guards/scopes';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { CONTROLLERS_INFO, SPEED_LIMITS_CONTROLLER } from '@libs/contracts/api';
import {
    CreateSpeedLimitCommand,
    DeleteSpeedLimitCommand,
    GetSpeedLimitsCommand,
    UpdateSpeedLimitCommand,
} from '@libs/contracts/commands';
import { ROLE } from '@libs/contracts/constants';

import {
    CreateSpeedLimitBodyDto,
    CreateSpeedLimitResponseDto,
    DeleteSpeedLimitParamDto,
    GetSpeedLimitsResponseDto,
    UpdateSpeedLimitBodyDto,
    UpdateSpeedLimitResponseDto,
} from './dtos';
import { SpeedLimitsService } from './speed-limits.service';

@ApiBearerAuth('Authorization')
@ApiScopeResource(CONTROLLERS_INFO.SPEED_LIMITS.resource)
@ApiTags(CONTROLLERS_INFO.SPEED_LIMITS.tag)
@Roles(ROLE.ADMIN, ROLE.API)
@UseGuards(JwtDefaultGuard, RolesGuard, ScopesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(SPEED_LIMITS_CONTROLLER)
export class SpeedLimitsController {
    constructor(private readonly service: SpeedLimitsService) {}

    @Endpoint({
        command: GetSpeedLimitsCommand,
        type: GetSpeedLimitsResponseDto,
        httpCode: HttpStatus.OK,
    })
    async getAll() {
        const result = await this.service.getAll();
        return { response: errorHandler(result) };
    }

    @Endpoint({
        command: CreateSpeedLimitCommand,
        type: CreateSpeedLimitResponseDto,
        httpCode: HttpStatus.CREATED,
    })
    async create(@Body() body: CreateSpeedLimitBodyDto) {
        const result = await this.service.create(body);
        return { response: errorHandler(result) };
    }

    @Endpoint({
        command: UpdateSpeedLimitCommand,
        type: UpdateSpeedLimitResponseDto,
        httpCode: HttpStatus.OK,
    })
    async update(@Body() body: UpdateSpeedLimitBodyDto) {
        const result = await this.service.update(body);
        return { response: errorHandler(result) };
    }

    @Endpoint({ command: DeleteSpeedLimitCommand, httpCode: HttpStatus.NO_CONTENT })
    async delete(@Param() params: DeleteSpeedLimitParamDto) {
        errorHandler(await this.service.delete(params.uuid));
    }
}
