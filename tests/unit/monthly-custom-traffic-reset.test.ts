import assert from 'node:assert/strict';
import test from 'node:test';

import { CreateUserCommand } from '../../libs/contract/commands/users/create-user.command';
import { RESET_PERIODS } from '../../libs/contract/constants';
import { getSubscriptionRefillDate } from '../../src/modules/subscription/utils/get-user-info.headers';
import {
    getMonthlyCustomResetDate,
    getNextMonthlyCustomResetAt,
    isMonthlyCustomResetDue,
    resolveTrafficResetScheduleUpdate,
} from '../../src/modules/users/utils/monthly-custom-reset.util';

const iso = (value: Date) => value.toISOString().slice(0, 10);
const createPayload = (day: number | null | undefined) => ({
    username: 'custom-reset-user',
    expireAt: '2027-09-22T00:00:00.000Z',
    trafficLimitStrategy: RESET_PERIODS.MONTH_CUSTOM_DAY,
    trafficLimitResetDay: day,
});

test('custom monthly reset DTO accepts days 1, 15, 28, 29, 30 and 31', () => {
    for (const day of [1, 15, 28, 29, 30, 31]) {
        assert.equal(
            CreateUserCommand.RequestBodySchema.safeParse(createPayload(day)).success,
            true,
        );
    }
});

test('custom monthly reset DTO rejects null, missing, zero and day 32', () => {
    for (const day of [null, undefined, 0, 32]) {
        assert.equal(
            CreateUserCommand.RequestBodySchema.safeParse(createPayload(day)).success,
            false,
        );
    }
});

test('custom reset day clamps to the last calendar day', () => {
    assert.equal(iso(getMonthlyCustomResetDate(2026, 0, 31)), '2026-01-31');
    assert.equal(iso(getMonthlyCustomResetDate(2026, 1, 31)), '2026-02-28');
    assert.equal(iso(getMonthlyCustomResetDate(2028, 1, 31)), '2028-02-29');
    assert.equal(iso(getMonthlyCustomResetDate(2026, 3, 31)), '2026-04-30');
    assert.equal(iso(getMonthlyCustomResetDate(2026, 1, 30)), '2026-02-28');
    assert.equal(iso(getMonthlyCustomResetDate(2026, 1, 29)), '2026-02-28');
    assert.equal(iso(getMonthlyCustomResetDate(2026, 11, 31)), '2026-12-31');
});

test('next reset uses this month before or on the due day and next month after it', () => {
    assert.equal(
        iso(
            getNextMonthlyCustomResetAt(
                new Date('2026-09-10T12:00:00Z'),
                15,
                new Date('2026-09-10T12:00:00Z'),
                null,
            ),
        ),
        '2026-09-15',
    );
    assert.equal(
        iso(
            getNextMonthlyCustomResetAt(
                new Date('2026-09-15T12:00:00Z'),
                15,
                new Date('2026-09-10T12:00:00Z'),
                null,
            ),
        ),
        '2026-09-15',
    );
    assert.equal(
        iso(
            getNextMonthlyCustomResetAt(
                new Date('2026-09-20T12:00:00Z'),
                15,
                new Date('2026-09-20T12:00:00Z'),
                null,
            ),
        ),
        '2026-10-15',
    );
});

test('a reset is due only once in the period and never before the effective timestamp', () => {
    const dueDay = new Date('2026-09-15T00:10:00Z');
    const createdBefore = new Date('2026-09-10T00:00:00Z');

    assert.equal(isMonthlyCustomResetDue(dueDay, 15, createdBefore, null), true);
    assert.equal(
        isMonthlyCustomResetDue(dueDay, 15, createdBefore, new Date('2026-09-15T00:05:00Z')),
        false,
    );
    assert.equal(
        isMonthlyCustomResetDue(dueDay, 15, new Date('2026-09-15T00:01:00Z'), null),
        false,
    );
});

test('changing reset day uses the change marker without clearing usage immediately', () => {
    const changedAt = new Date('2026-09-20T12:00:00Z');

    assert.equal(
        iso(getNextMonthlyCustomResetAt(changedAt, 5, changedAt, changedAt)),
        '2026-10-05',
    );
    assert.equal(
        iso(getNextMonthlyCustomResetAt(changedAt, 25, changedAt, changedAt)),
        '2026-09-25',
    );
});

test('strategy and reset-day edits normalize the stored pair and create a schedule marker', () => {
    const changedAt = new Date('2026-09-20T12:00:00Z');
    const changedDay = resolveTrafficResetScheduleUpdate({
        currentStrategy: RESET_PERIODS.MONTH_CUSTOM_DAY,
        currentResetDay: 20,
        requestedStrategy: undefined,
        requestedResetDay: 5,
        changedAt,
    });
    assert.deepEqual(changedDay, {
        strategy: RESET_PERIODS.MONTH_CUSTOM_DAY,
        resetDay: 5,
        scheduleAnchor: changedAt,
    });

    const disabled = resolveTrafficResetScheduleUpdate({
        currentStrategy: RESET_PERIODS.MONTH_CUSTOM_DAY,
        currentResetDay: 20,
        requestedStrategy: RESET_PERIODS.NO_RESET,
        requestedResetDay: undefined,
        changedAt,
    });
    assert.deepEqual(disabled, {
        strategy: RESET_PERIODS.NO_RESET,
        resetDay: null,
        scheduleAnchor: null,
    });
});

test('custom strategy edits reject an explicit null day', () => {
    assert.throws(() =>
        resolveTrafficResetScheduleUpdate({
            currentStrategy: RESET_PERIODS.MONTH_CUSTOM_DAY,
            currentResetDay: 15,
            requestedStrategy: undefined,
            requestedResetDay: null,
            changedAt: new Date('2026-09-20T12:00:00Z'),
        }),
    );
});

test('subscription refill metadata exposes the next custom reset date', () => {
    const refillDate = getSubscriptionRefillDate(
        {
            trafficLimitStrategy: RESET_PERIODS.MONTH_CUSTOM_DAY,
            trafficLimitResetDay: 25,
            trafficLimitResetAnchorAt: new Date('2026-09-10T00:00:00Z'),
            createdAt: new Date('2026-09-10T00:00:00Z'),
            lastTrafficResetAt: null,
        } as never,
        new Date('2026-09-22T12:00:00Z'),
    );

    assert.equal(refillDate, String(Date.parse('2026-09-25T00:00:00Z') / 1_000));
});
