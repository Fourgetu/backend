import { UserRoutes } from '@prisma/client';

export class UserRouteEntity implements Omit<UserRoutes, 'userId'> {
    public uuid: string;
    public userId: number;
    public nodeUuid: string;
    public configProfileInboundUuid: string;
    public hostUuid: string;
    public speedLimitUuid: string | null;
    public portHoppingConfigUuid: string | null;
    public externalPort: number;
    public internalAddress: string;
    public internalPort: number;
    public gostForwardId: string | null;
    public gostServiceName: string | null;
    public network: string;
    public enabled: boolean;
    public hopStartPort: number | null;
    public hopEndPort: number | null;
    public createdAt: Date;
    public updatedAt: Date;

    constructor(value: Partial<UserRouteEntity>) {
        Object.assign(this, value);
        return this;
    }
}
