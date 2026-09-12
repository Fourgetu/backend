import {
    Body,
    Controller,
    HttpStatus,
    Param,
    Query,
    UseFilters,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles/roles.guard';
import { ScopesGuard } from '@common/guards/scopes';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { CONTROLLERS_INFO, USER_ROUTES_CONTROLLER } from '@libs/contracts/api';
import {
    CreateUserRouteCommand,
    DeleteUserRouteCommand,
    GetUserRoutesCommand,
    GetUserRouteRuntimeStatusCommand,
    ReallocateUserRoutePortCommand,
    UpdateUserRouteCommand,
    CreatePortHoppingConfigCommand,
    DeletePortHoppingConfigCommand,
    GetPortHoppingConfigsCommand,
    UpdatePortHoppingConfigCommand,
} from '@libs/contracts/commands';
import { ROLE } from '@libs/contracts/constants';

import {
    CreateUserRouteBodyDto,
    CreateUserRouteResponseDto,
    DeleteUserRouteParamDto,
    GetUserRoutesQueryDto,
    GetUserRoutesResponseDto,
    GetUserRouteRuntimeStatusParamDto,
    GetUserRouteRuntimeStatusResponseDto,
    ReallocateUserRoutePortParamDto,
    ReallocateUserRoutePortResponseDto,
    UpdateUserRouteBodyDto,
    UpdateUserRouteResponseDto,
    CreatePortHoppingConfigBodyDto,
    CreatePortHoppingConfigResponseDto,
    DeletePortHoppingConfigParamDto,
    GetPortHoppingConfigsQueryDto,
    GetPortHoppingConfigsResponseDto,
    UpdatePortHoppingConfigBodyDto,
    UpdatePortHoppingConfigParamDto,
    UpdatePortHoppingConfigResponseDto,
} from './dtos';
import { PortHoppingConfigsService } from './port-hopping-configs.service';
import { UserRoutesService } from './user-routes.service';

@ApiBearerAuth('Authorization')
@ApiScopeResource(CONTROLLERS_INFO.USER_ROUTES.resource)
@ApiTags(CONTROLLERS_INFO.USER_ROUTES.tag)
@Roles(ROLE.ADMIN, ROLE.API)
@UseGuards(JwtDefaultGuard, RolesGuard, ScopesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(USER_ROUTES_CONTROLLER)
export class UserRoutesController {
    constructor(
        private readonly service: UserRoutesService,
        private readonly portHoppingConfigsService: PortHoppingConfigsService,
    ) {}

    @Endpoint({
        command: GetPortHoppingConfigsCommand,
        type: GetPortHoppingConfigsResponseDto,
        httpCode: HttpStatus.OK,
    })
    async getPortHoppingConfigs(@Query() query: GetPortHoppingConfigsQueryDto) {
        return {
            response: errorHandler(await this.portHoppingConfigsService.getAll(query)),
        };
    }

    @Endpoint({
        command: CreatePortHoppingConfigCommand,
        type: CreatePortHoppingConfigResponseDto,
        httpCode: HttpStatus.CREATED,
    })
    async createPortHoppingConfig(@Body() body: CreatePortHoppingConfigBodyDto) {
        return {
            response: errorHandler(await this.portHoppingConfigsService.create(body)),
        };
    }

    @Endpoint({
        command: UpdatePortHoppingConfigCommand,
        type: UpdatePortHoppingConfigResponseDto,
        httpCode: HttpStatus.OK,
    })
    async updatePortHoppingConfig(
        @Param() params: UpdatePortHoppingConfigParamDto,
        @Body() body: UpdatePortHoppingConfigBodyDto,
    ) {
        return {
            response: errorHandler(
                await this.portHoppingConfigsService.update(params.uuid, body),
            ),
        };
    }

    @Endpoint({ command: DeletePortHoppingConfigCommand, httpCode: HttpStatus.NO_CONTENT })
    async deletePortHoppingConfig(@Param() params: DeletePortHoppingConfigParamDto) {
        errorHandler(await this.portHoppingConfigsService.delete(params.uuid));
    }

    @Endpoint({
        command: GetUserRoutesCommand,
        type: GetUserRoutesResponseDto,
        httpCode: HttpStatus.OK,
    })
    async getAll(@Query() query: GetUserRoutesQueryDto) {
        return { response: errorHandler(await this.service.getAll(query)) };
    }

    @Endpoint({
        command: GetUserRouteRuntimeStatusCommand,
        type: GetUserRouteRuntimeStatusResponseDto,
        httpCode: HttpStatus.OK,
    })
    async getRuntimeStatus(@Param() params: GetUserRouteRuntimeStatusParamDto) {
        return { response: errorHandler(await this.service.getRuntimeStatus(params.nodeUuid)) };
    }

    @Endpoint({
        command: ReallocateUserRoutePortCommand,
        type: ReallocateUserRoutePortResponseDto,
        httpCode: HttpStatus.OK,
    })
    async reallocatePort(@Param() params: ReallocateUserRoutePortParamDto) {
        return { response: errorHandler(await this.service.reallocatePort(params.uuid)) };
    }

    @Endpoint({
        command: CreateUserRouteCommand,
        type: CreateUserRouteResponseDto,
        httpCode: HttpStatus.CREATED,
    })
    async create(@Body() body: CreateUserRouteBodyDto) {
        return { response: errorHandler(await this.service.create(body)) };
    }

    @Endpoint({
        command: UpdateUserRouteCommand,
        type: UpdateUserRouteResponseDto,
        httpCode: HttpStatus.OK,
    })
    async update(@Body() body: UpdateUserRouteBodyDto) {
        return { response: errorHandler(await this.service.update(body)) };
    }

    @Endpoint({ command: DeleteUserRouteCommand, httpCode: HttpStatus.NO_CONTENT })
    async delete(@Param() params: DeleteUserRouteParamDto) {
        errorHandler(await this.service.delete(params.uuid));
    }
}
