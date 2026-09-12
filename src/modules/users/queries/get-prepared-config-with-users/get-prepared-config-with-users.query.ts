import { Query } from '@nestjs/cqrs';

import { StartXrayCommand } from '@remnawave/node-contract';

import { TResult } from '@common/types';
import { TConfigProfileCoreType } from '@libs/contracts/constants';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

export interface IGetPreparedConfigWithUsersResponse {
    coreType: TConfigProfileCoreType;
    config: object;
    hashesPayload: StartXrayCommand.Request['internals']['hashes'];
}

export class GetPreparedConfigWithUsersQuery extends Query<
    TResult<IGetPreparedConfigWithUsersResponse>
> {
    constructor(
        public readonly configProfileUuid: string,
        public readonly activeInbounds: ConfigProfileInboundEntity[],
    ) {
        super();
    }
}
