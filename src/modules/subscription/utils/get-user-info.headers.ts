import dayjs from 'dayjs';

import { getNextTrafficResetAt } from '@common/utils/get-next-traffic-reset-at.util';

import { UserEntity } from '@modules/users/entities';

interface SubscriptionUserInfo {
    download: number;
    expire: number;
    total: number;
    upload: number;
}

export function getSubscriptionUserInfo(user: UserEntity): SubscriptionUserInfo {
    return {
        upload: 0,
        download: Number(user.userTraffic.usedTrafficBytes),
        total: Number(user.trafficLimitBytes),
        // TODO: remove after XTLS Standards published
        expire: user.expireAt.getFullYear() !== 2099 ? dayjs(user.expireAt).unix() : 0,
    };
}

export function getSubscriptionRefillDate(
    user: UserEntity,
    currentDate: Date = new Date(),
): string | undefined {
    const nextResetAt = getNextTrafficResetAt(user, currentDate);
    return nextResetAt ? dayjs(nextResetAt).unix().toString() : undefined;
}
