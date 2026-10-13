# Selected upstream fixes — 2026-10-13

Based on custom-v0.2.13. These changes selectively backport upstream fixes without upgrading the upstream base version or changing database migrations.

| Upstream backend commit                  | Change                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| dec0fcca4e47f13e835ebe7466dab68911d03273 | Generate `grpcSettings.multiMode` in Xray JSON subscriptions.                            |
| 814fb05460b0205a781635872e8934356e15185b | Match user/report numeric IDs exactly as bigint; invalid IDs produce no matches.         |
| 44e87e3527278f7b3d1da62491d971cab4bb8b13 | Export subscription response type as `srrResponseType`.                                  |
| 74e27b7ecf2ac6fac9368deefd5516aee2446f81 | Retain affected node task success/failure records for 12 hours, capped at 500 per state. |

## Behavior changes

- User ID and torrent report ID/user ID/node ID filters now require an exact numeric ID. Valid Telegram ID searches continue to support partial matches; invalid Telegram IDs return no matches.
- Redis Stream consumers of subscription request events must read `srrResponseType`, replacing the old misspelled `ssrResponseType`. Existing stream entries are not rewritten, so consumers processing older entries should accept both names during transition.
- The affected node job queues retain less completed/failed history. This does not change user traffic counters or subscription request history retention.

The SNI toggle, post-start plugin, Host cloning, reset-date variables and node edit/restart optimizations require separate adaptation for this fork and are not part of this change.

Regression coverage compiles repository filters with the PostgreSQL dialect without a database connection, serializes a gRPC subscription, and processes a subscription event against a captured Stream export. These checks do not constitute a live PostgreSQL/Redis or VPS smoke test.
