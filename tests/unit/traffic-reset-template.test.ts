import assert from 'node:assert/strict';
import test from 'node:test';

import { RESET_PERIODS, TResetPeriods } from '../../libs/contract/constants';
import { getNextTrafficResetAt } from '../../src/common/utils/get-next-traffic-reset-at.util';
import { TemplateEngine } from '../../src/common/utils/templates/replace-templates-values';
import { getSubscriptionRefillDate } from '../../src/modules/subscription/utils/get-user-info.headers';

process.env.TZ = 'UTC';

const user = (trafficLimitStrategy: TResetPeriods = RESET_PERIODS.MONTH_CUSTOM_DAY) => ({
    trafficLimitStrategy,
    trafficLimitResetDay: 31,
    trafficLimitResetAnchorAt: null as Date | null,
    createdAt: new Date('2026-01-31T12:00:00Z'),
    lastTrafficResetAt: null as Date | null,
});

test('calendar reset metadata follows daily, weekly and monthly scheduler offsets', () => {
    const cases = [
        [RESET_PERIODS.DAY, '2026-10-13T00:04:00Z', '2026-10-13T00:05:00Z'],
        [RESET_PERIODS.DAY, '2026-10-13T00:05:00Z', '2026-10-14T00:05:00Z'],
        [RESET_PERIODS.WEEK, '2026-10-11T12:00:00Z', '2026-10-12T00:15:00Z'],
        [RESET_PERIODS.WEEK, '2026-10-12T00:14:00Z', '2026-10-12T00:15:00Z'],
        [RESET_PERIODS.WEEK, '2026-10-12T00:15:00Z', '2026-10-19T00:15:00Z'],
        [RESET_PERIODS.MONTH, '2026-12-31T12:00:00Z', '2027-01-01T00:20:00Z'],
    ] as const;
    for (const [strategy, now, expected] of cases) {
        assert.equal(
            getNextTrafficResetAt(user(strategy), new Date(now))?.toISOString(),
            new Date(expected).toISOString(),
        );
    }
});

test('rolling months clamp short months and never reset in the creation month', () => {
    const schedule = user(RESET_PERIODS.MONTH_ROLLING);
    for (const now of ['2026-01-31T12:01:00Z', '2026-02-01T12:00:00Z']) {
        assert.equal(
            getNextTrafficResetAt(schedule, new Date(now))?.toISOString(),
            '2026-02-28T00:10:00.000Z',
        );
    }
    assert.equal(
        getNextTrafficResetAt(schedule, new Date('2026-02-28T00:10:00Z'))?.toISOString(),
        '2026-03-31T00:10:00.000Z',
    );
});

test('custom reset dates retain UTC dates, clamp leap years and advance after a completed reset', () => {
    const schedule = user();
    assert.equal(
        getNextTrafficResetAt(schedule, new Date('2028-02-01T00:00:00Z'))?.toISOString(),
        '2028-02-29T00:00:00.000Z',
    );
    schedule.lastTrafficResetAt = new Date('2028-02-29T00:10:00Z');
    assert.equal(
        getNextTrafficResetAt(schedule, new Date('2028-02-29T00:11:00Z'))?.toISOString(),
        '2028-03-31T00:00:00.000Z',
    );
});

test('a custom schedule changed after midnight cannot advertise an already ineligible reset day', () => {
    const schedule = {
        ...user(),
        trafficLimitResetDay: 13,
        trafficLimitResetAnchorAt: new Date('2026-10-13T00:01:00Z'),
    };
    assert.equal(
        getNextTrafficResetAt(schedule, new Date('2026-10-13T00:02:00Z'))?.toISOString(),
        '2026-11-13T00:00:00.000Z',
    );
});

test('subscription header and formatted template share the custom reset date and format arguments', () => {
    const schedule = { ...user(), lastTrafficResetAt: new Date('2026-01-31T00:10:00Z') };
    const now = new Date('2026-02-01T12:00:00Z');
    const values = TemplateEngine.createUserValueMap(
        schedule as never,
        {} as never,
        'example.com',
        now,
    );
    assert.equal(
        String(values.NEXT_TRAFFIC_RESET_AT_UNIX({})),
        getSubscriptionRefillDate(schedule as never, now),
    );
    assert.equal(
        TemplateEngine.replace(
            '{{NEXT_TRAFFIC_RESET_AT}} / {{NEXT_TRAFFIC_RESET_AT:format=YYYY-MM-DD}} / {{LAST_TRAFFIC_RESET_AT:format=YYYY-MM-DD}}',
            values,
        ),
        '28.02.2026 / 2026-02-28 / 2026-01-31',
    );
});

test('no-reset strategy has no header and empty date variables, with zero Unix fallback', () => {
    const schedule = user(RESET_PERIODS.NO_RESET);
    const values = TemplateEngine.createUserValueMap(schedule as never, {} as never, 'example.com');
    assert.equal(getSubscriptionRefillDate(schedule as never), undefined);
    assert.equal(
        TemplateEngine.replace(
            '{{NEXT_TRAFFIC_RESET_AT}}|{{NEXT_TRAFFIC_RESET_AT_UNIX}}|{{LAST_TRAFFIC_RESET_AT}}',
            values,
        ),
        '|0|',
    );
});
