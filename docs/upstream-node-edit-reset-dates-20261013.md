# Node edits and reset-date templates — 2026-10-13

Adapted from upstream backend `ce86b492` and `937ff20b`, following the selected fixes documented in `upstream-safe-backports-20261013.md`.

## Node updates

The node update endpoint trims names and applies runtime configuration only when the request supplies an address, port, proxy, plugin, integrations, Xray binding or sing-box binding. Name, note, provider and billing-only updates do not enqueue a core start.

Both profile slots use the same presence rule: omitted means unchanged, while `null` means detach and must trigger application. Disabled nodes remain stopped. Removing integrations still forces application. The companion frontend sends only changed fields and calculates dirtiness independently for the two profile slots.

## Subscription reset dates

The subscription refill header and the following template variables share one calculation:

- `{{LAST_TRAFFIC_RESET_AT}}`
- `{{NEXT_TRAFFIC_RESET_AT_UNIX}}`
- `{{NEXT_TRAFFIC_RESET_AT}}`

Formatted date variables default to `DD.MM.YYYY`. For example, `{{NEXT_TRAFFIC_RESET_AT:format=YYYY-MM-DD}}` selects another format. A missing date renders as an empty string; the next-reset Unix variable returns zero for no-reset users, and the refill header is omitted.

Calendar strategies use the existing scheduler's local-time offsets: daily 00:05, Monday 00:15, first of month 00:20, and rolling monthly 00:10. Rolling monthly dates clamp to the end of short months and cannot precede the first month after creation. These values describe the schedule, not a guarantee of queue execution time.

The custom monthly strategy retains the fork's UTC reset-day metadata and uses its configured day, schedule anchor and last completed reset. Its timestamp identifies the reset day at UTC midnight; the existing reset job continues running separately. An anchor set after midnight on a reset day now excludes that already ineligible date, matching the reset eligibility check.

No scheduler jobs or database schema are changed. Frontend and backend should be delivered together so newly listed variables are recognized by the backend and partial node edits receive the reduced-restart behavior.

Validation: 101 backend unit tests passed, including service-level node update cases and date/template regressions; production Rspack build, TypeScript checks, changed-file lint/format and Node contract checks passed. Validation used local dependencies and Node.js 24.15.0; a supported production Node.js/container smoke test remains a release-stage check.
