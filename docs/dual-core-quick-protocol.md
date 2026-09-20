# Dual-core Quick Protocol — compatibility and audit

Target runtimes: Xray 26.7.28 and sing-box 1.13.14.
This is a local implementation, not a release or production acceptance record.

## Provisioning boundary

| Protocol / method | Xray managed provisioning | sing-box managed provisioning |
| --- | --- | --- |
| VLESS Reality Vision / raw TCP | Enabled | Enabled |
| SS2022 AES-128 | Enabled | Enabled |
| SS2022 AES-256 | Enabled | Enabled |
| SS2022 ChaCha20 | Rejected | Rejected |
| Hysteria2 | No new Quick Protocol / Quick Deploy | Existing path retained |
| Trojan TCP TLS | Existing template retained | Not newly enabled |
| Traditional Shadowsocks AEAD | Existing managed adapter retained | Rejected in Managed Users mode |
| VMess | Not newly enabled | Not newly enabled |

Native cipher/protocol support is not equivalent to a complete managed-user
pipeline. The frontend capability matrix keeps these separate. ChaCha20 remains
visible but disabled, with a version-specific explanation in English and Chinese.
Both backend validators reject it; no method substitution or shared-password
fallback is performed.

Trojan's native user and subscription representations are compatible, but its
sing-box Quick Deploy certificate/runtime path has not had complete core-level
acceptance, so that extra template remains closed. Traditional sing-box AEAD has
no equivalent multi-user inbound for this implementation. VMess is absent from
the managed protocol set and user update/subscription paths. Reality gRPC keeps
its existing Xray-only provisioning gate; no gRPC equivalence is claimed.

## Native configuration and credentials

The old Quick Protocol modal called only the Xray builder. It now receives the
Profile's explicit core type and invokes the corresponding native builder.
Quick Deploy, graphical add/edit, profile assignment and Host creation use the
same capability boundary. Missing core types do not default to Xray.

Xray Reality uses `protocol`, `settings`, `streamSettings.realitySettings`,
`target`, `serverNames`, `privateKey`, `shortIds`; the existing `settings.flow`
and `minClientVer` policy remain intact.

sing-box Reality uses:

```json
{
  "type": "vless",
  "tag": "generated-unique-tag",
  "listen": "127.0.0.1",
  "listen_port": 23456,
  "users": [],
  "tls": {
    "enabled": true,
    "server_name": "example.com",
    "reality": {
      "enabled": true,
      "handshake": { "server": "example.com", "server_port": 443 },
      "private_key": "<generated X25519 private key>",
      "short_id": ["<generated 8-byte hex short ID>"]
    }
  }
}
```

The placeholders above are documentation only. Templates generate real keys
using the existing secure X25519 helper, derive the public key from the private
key, and generate short IDs using Web Crypto. The backend injects each enabled
user's `name`, `uuid`, and `flow: xtls-rprx-vision` into native Reality/raw-TCP
inbounds. No Xray-only fields or `minClientVer` are injected into sing-box.

SS2022 server keys are Web Crypto random bytes encoded with standard base64:
16 bytes for AES-128; 32 bytes for AES-256. Xray uses
`settings.{method,password,network,clients}` (the existing managed Xray
representation); sing-box uses top-level `{method,password,users}`.

User keys are independent of the shared inbound server key:

- AES-128: first 16 bytes of SHA-256 over a domain-separated user password.
- AES-256: preserve the existing base64 encoding for 32-byte user passwords.
  Short/custom UTF-8 passwords use a separate domain-separated SHA-256 key,
  ensuring a valid 32-byte value instead of passing an invalid length to a core.
- Clients receive `serverKey:userKey`. The same helper is used by full config
  reconciliation, incremental single-user updates and subscription generation.
- SS2022 add/update/remove events enqueue authoritative Node reconciliation, since the old
  batch contract has one raw password per user, not a per-inbound cipher. It
  must not send one ambiguous key to mixed AES-128/AES-256 inbounds.
- Disabled/deleted users are omitted from snapshots. Both core snapshots omit
  zero-user SS2022 inbounds. Node also omits an empty managed SS listener from
  runtime while retaining its in-memory template for a subsequent user restore.
  No shared-user downgrade is introduced.

Mihomo receives standard VLESS Reality fields (`uuid`, `flow`, `tls`,
`servername`, `client-fingerprint`, `reality-opts.public-key` and `short-id`),
or SS cipher plus composed password. Private keys and internal listen addresses
are not emitted as client connection settings.

## GOST and Host integration

Matching Profile/inbound UUIDs and independent core slots remain unchanged.
Loopback listeners use strict forwarding. Explicit wildcard compatibility
supports Xray/sing-box `0.0.0.0` or `::`, targeting matching loopback addresses.
The risk confirmation remains mandatory in the UI: the original public core
port may bypass GOST. No firewall or Profile listener is changed.

SS2022's default `tcp,udp` User Route uses one external port and two ordinary
Node forward entries sharing a route UUID. Node creates two listeners and one
shared limiter. Its existing Node contract remains unchanged. Frontend/Backend
route DTOs understand `tcp,udp`; the database already stores a string, so no
migration is needed.

Reservation checks intersect combined routes with both single-network sets.
Overlapping routes for the same user/Node/Host/inbound are rejected. Existing
single-network routes are retained; TCP-only SS routes are no longer advertised
as UDP-capable in Mihomo/sing-box output. HY2 hopping remains UDP-only.

**A future deployment of this feature must include this Node change**, not just
Frontend/Backend: an older Node may produce duplicate limiter definitions for
the two forward entries. No image or release was published by this work.

## Graphical editing and validation

Native Reality security shows handshake host/port, SNI, masked private key,
derived public key, short IDs and fixed Vision flow. SS2022 shows method,
masked server key, Managed Users and network. Changing cipher does not silently
replace a key; validation requires a matching key length. ChaCha20 cannot be
selected. Targeted edits preserve unknown fields and managed users.

Core-aware save routing remains intact: Xray WASM for Xray, sing-box schema for
sing-box. Invalid graphical edits retain the source/draft and display an error.

## Verification scope

Regression coverage includes both AES methods on both cores; ChaCha20 rejection;
per-user credentials; short/custom passwords; incremental/bulk update routing;
user removal; Reality public-key derivation and Mihomo output; native field
separation; core-specific deployment and Host binding; graphical round-trip;
GOST dual-network forwards/limiter sharing, port reservations and overlapping route checks.

No VPS SSH, Docker smoke test, npm publication, push, tag or release is part of
this change. No installed Xray/sing-box executable was found in the checked
workspace/PATH, so native binary config checks and real protocol connectivity
are **not** recorded as passed. Unit tests and builds do not replace those
future runtime acceptance checks.
