export class UserForConfigEntity {
    public trojanPassword: string;
    public vlessUuid: string;
    public ssPassword: string;
    public socksUsername: string;
    public socksPassword: string;
    public tags: string[];
    public id: bigint;

    constructor(data: UserForConfigEntity) {
        this.trojanPassword = data.trojanPassword;
        this.vlessUuid = data.vlessUuid;
        this.ssPassword = data.ssPassword;
        this.socksUsername = data.socksUsername;
        this.socksPassword = data.socksPassword;
        this.tags = data.tags;
        this.id = data.id;
    }
}
