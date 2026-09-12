import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

export class UserWithResolvedInboundEntity {
    public id: bigint;
    public trojanPassword: string;
    public vlessUuid: string;
    public ssPassword: string;
    public socksUsername: string;
    public socksPassword: string;

    public inbounds: ConfigProfileInboundEntity[];

    constructor(data: UserWithResolvedInboundEntity) {
        this.id = data.id;
        this.trojanPassword = data.trojanPassword;
        this.vlessUuid = data.vlessUuid;
        this.ssPassword = data.ssPassword;
        this.socksUsername = data.socksUsername;
        this.socksPassword = data.socksPassword;
        this.inbounds = data.inbounds;
    }
}
