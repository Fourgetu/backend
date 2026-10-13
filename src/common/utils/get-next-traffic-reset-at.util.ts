import dayjs from 'dayjs';

import { RESET_PERIODS } from '@libs/contracts/constants';

import type { UserEntity } from '@modules/users/entities';
import { getNextMonthlyCustomResetAt } from '@modules/users/utils/monthly-custom-reset.util';

type TrafficResetSchedule = Pick<
    UserEntity,
    | 'trafficLimitStrategy'
    | 'createdAt'
    | 'trafficLimitResetDay'
    | 'trafficLimitResetAnchorAt'
    | 'lastTrafficResetAt'
>;

// Calendar offsets match the scheduler; custom-day dates retain the fork's UTC-day semantics.
export function getNextTrafficResetAt(
    user: TrafficResetSchedule,
    currentDate: Date = new Date(),
): Date | null {
    const now = dayjs(currentDate);

    switch (user.trafficLimitStrategy) {
        case RESET_PERIODS.NO_RESET:
            return null;
        case RESET_PERIODS.DAY: {
            const next = now.startOf('day').add(5, 'minute');
            return (next.isAfter(now) ? next : next.add(1, 'day')).toDate();
        }
        case RESET_PERIODS.WEEK: {
            const next = now
                .startOf('day')
                .add((1 - now.day() + 7) % 7, 'day')
                .add(15, 'minute');
            return (next.isAfter(now) ? next : next.add(7, 'day')).toDate();
        }
        case RESET_PERIODS.MONTH: {
            const next = now.startOf('month').add(20, 'minute');
            return (next.isAfter(now) ? next : next.add(1, 'month')).toDate();
        }
        case RESET_PERIODS.MONTH_ROLLING: {
            const anchorDay = dayjs(user.createdAt).date();
            const resetAtIn = (month: dayjs.Dayjs): dayjs.Dayjs => {
                const monthStart = month.startOf('month');
                return monthStart
                    .date(Math.min(anchorDay, monthStart.daysInMonth()))
                    .add(10, 'minute');
            };
            const next = resetAtIn(now);
            const resolved = next.isAfter(now) ? next : resetAtIn(now.add(1, 'month'));
            const firstReset = resetAtIn(dayjs(user.createdAt).add(1, 'month'));
            return (resolved.isBefore(firstReset) ? firstReset : resolved).toDate();
        }
        case RESET_PERIODS.MONTH_CUSTOM_DAY:
            if (user.trafficLimitResetDay == null) return null;
            return getNextMonthlyCustomResetAt(
                currentDate,
                user.trafficLimitResetDay,
                user.trafficLimitResetAnchorAt ?? user.createdAt,
                user.lastTrafficResetAt,
            );
    }
}
