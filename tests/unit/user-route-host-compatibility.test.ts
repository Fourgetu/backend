import assert from 'node:assert/strict';
import test from 'node:test';

import { isHostCompatibleWithUserRoute } from '../../src/modules/user-routes/user-route-host-compatibility';

const XRAY_PROFILE_UUID = '00000000-0000-4000-8000-000000000001';
const SINGBOX_PROFILE_UUID = '00000000-0000-4000-8000-000000000002';
const XRAY_INBOUND_UUID = '00000000-0000-4000-8000-000000000003';
const SINGBOX_INBOUND_UUID = '00000000-0000-4000-8000-000000000004';
const VMRACK_NODE_UUID = '00000000-0000-4000-8000-000000000005';
const OTHER_NODE_UUID = '00000000-0000-4000-8000-000000000006';

const host = (profileUuid: string, inboundUuid: string, nodeUuids: string[] = []) => ({
    configProfileInboundUuid: inboundUuid,
    configProfileUuid: profileUuid,
    nodeUuids,
});

test('accepts matching Xray and sing-box hosts', () => {
    assert.equal(
        isHostCompatibleWithUserRoute(
            host(XRAY_PROFILE_UUID, XRAY_INBOUND_UUID, [VMRACK_NODE_UUID]),
            VMRACK_NODE_UUID,
            { profileUuid: XRAY_PROFILE_UUID, uuid: XRAY_INBOUND_UUID },
        ),
        true,
    );
    assert.equal(
        isHostCompatibleWithUserRoute(
            host(SINGBOX_PROFILE_UUID, SINGBOX_INBOUND_UUID),
            VMRACK_NODE_UUID,
            { profileUuid: SINGBOX_PROFILE_UUID, uuid: SINGBOX_INBOUND_UUID },
        ),
        true,
    );
});

test('rejects a host explicitly assigned to another node', () => {
    assert.equal(
        isHostCompatibleWithUserRoute(
            host(SINGBOX_PROFILE_UUID, SINGBOX_INBOUND_UUID, [OTHER_NODE_UUID]),
            VMRACK_NODE_UUID,
            { profileUuid: SINGBOX_PROFILE_UUID, uuid: SINGBOX_INBOUND_UUID },
        ),
        false,
    );
});

test('rejects hosts from another inbound, profile, or core', () => {
    assert.equal(
        isHostCompatibleWithUserRoute(
            host(SINGBOX_PROFILE_UUID, XRAY_INBOUND_UUID),
            VMRACK_NODE_UUID,
            { profileUuid: SINGBOX_PROFILE_UUID, uuid: SINGBOX_INBOUND_UUID },
        ),
        false,
    );
    assert.equal(
        isHostCompatibleWithUserRoute(
            host(XRAY_PROFILE_UUID, SINGBOX_INBOUND_UUID),
            VMRACK_NODE_UUID,
            { profileUuid: SINGBOX_PROFILE_UUID, uuid: SINGBOX_INBOUND_UUID },
        ),
        false,
    );
});
