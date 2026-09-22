ALTER TABLE "users"
ADD COLUMN "traffic_limit_reset_day" INTEGER,
ADD COLUMN "traffic_limit_reset_anchor_at" TIMESTAMP(3);

ALTER TABLE "users"
ADD CONSTRAINT "users_traffic_limit_reset_day_range_check"
CHECK (
    "traffic_limit_reset_day" IS NULL
    OR "traffic_limit_reset_day" BETWEEN 1 AND 31
);

ALTER TABLE "users"
ADD CONSTRAINT "users_traffic_limit_reset_day_strategy_check"
CHECK (
    (
        "traffic_limit_strategy" = 'MONTH_CUSTOM_DAY'
        AND "traffic_limit_reset_day" IS NOT NULL
    )
    OR (
        "traffic_limit_strategy" <> 'MONTH_CUSTOM_DAY'
        AND "traffic_limit_reset_day" IS NULL
    )
);
