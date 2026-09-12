import { SpeedLimits } from '@prisma/client';

export class SpeedLimitEntity implements Omit<SpeedLimits, 'downloadBytesPerSecond' | 'uploadBytesPerSecond'> {
    public uuid: string;
    public name: string;
    public downloadBytesPerSecond: number;
    public uploadBytesPerSecond: number;
    public enabled: boolean;
    public createdAt: Date;
    public updatedAt: Date;

    constructor(value: Partial<SpeedLimitEntity>) {
        Object.assign(this, value);
        return this;
    }
}
