const startOfUtcDay = (date: Date): Date =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const getMonthlyCustomResetDate = (
    year: number,
    monthIndex: number,
    configuredDay: number,
): Date => {
    if (!Number.isInteger(configuredDay) || configuredDay < 1 || configuredDay > 31) {
        throw new RangeError('Configured reset day must be an integer between 1 and 31');
    }

    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const actualDay = Math.min(configuredDay, daysInMonth);

    return new Date(Date.UTC(year, monthIndex, actualDay));
};

export const getNextMonthlyCustomResetAt = (
    now: Date,
    configuredDay: number,
    effectiveAt: Date,
    lastTrafficResetAt: Date | null,
): Date => {
    let candidate = getMonthlyCustomResetDate(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        configuredDay,
    );
    const today = startOfUtcDay(now);
    const effectiveDay = startOfUtcDay(effectiveAt);
    const lastResetDay = lastTrafficResetAt ? startOfUtcDay(lastTrafficResetAt) : null;

    if (
        candidate < today ||
        candidate < effectiveDay ||
        (lastResetDay !== null && lastResetDay >= candidate)
    ) {
        const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        candidate = getMonthlyCustomResetDate(
            nextMonth.getUTCFullYear(),
            nextMonth.getUTCMonth(),
            configuredDay,
        );
    }

    return candidate;
};

export const isMonthlyCustomResetDue = (
    now: Date,
    configuredDay: number,
    effectiveAt: Date,
    lastTrafficResetAt: Date | null,
): boolean => {
    const today = startOfUtcDay(now);
    const candidate = getMonthlyCustomResetDate(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        configuredDay,
    );

    return (
        candidate.getTime() === today.getTime() &&
        effectiveAt <= candidate &&
        (lastTrafficResetAt === null || lastTrafficResetAt < candidate)
    );
};

export const resolveTrafficResetScheduleUpdate = ({
    currentStrategy,
    currentResetDay,
    requestedStrategy,
    requestedResetDay,
    changedAt,
}: {
    currentStrategy: TResetPeriods;
    currentResetDay: number | null;
    requestedStrategy: TResetPeriods | undefined;
    requestedResetDay: number | null | undefined;
    changedAt: Date;
}): {
    strategy: TResetPeriods;
    resetDay: number | null;
    scheduleAnchor: Date | null | undefined;
} => {
    const strategy = requestedStrategy ?? currentStrategy;
    const resetDay =
        strategy === RESET_PERIODS.MONTH_CUSTOM_DAY
            ? requestedResetDay !== undefined
                ? requestedResetDay
                : currentResetDay
            : null;

    if (resetDay !== null && (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31)) {
        throw new RangeError('Configured reset day must be an integer between 1 and 31');
    }
    if (strategy === RESET_PERIODS.MONTH_CUSTOM_DAY && resetDay === null) {
        throw new Error('Traffic reset day is required for monthly custom day strategy');
    }

    const changed =
        (requestedStrategy !== undefined && requestedStrategy !== currentStrategy) ||
        (requestedResetDay !== undefined && resetDay !== currentResetDay);

    return {
        strategy,
        resetDay,
        scheduleAnchor: changed
            ? strategy === RESET_PERIODS.MONTH_CUSTOM_DAY
                ? changedAt
                : null
            : undefined,
    };
};
import { RESET_PERIODS, TResetPeriods } from '@contract/constants';
