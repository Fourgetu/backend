import assert from 'node:assert/strict';
import test from 'node:test';

import { CreateNodeCommand, UpdateNodeCommand } from '../../libs/contract/commands';
import { getCoreProfileAssignments } from '../../src/queue/_nodes/processors/core-profile-assignments';

const NODE_UUID = '00000000-0000-4000-8000-000000000001';
const XRAY_PROFILE_UUID = '00000000-0000-4000-8000-000000000002';
const SINGBOX_PROFILE_UUID = '00000000-0000-4000-8000-000000000003';
const XRAY_INBOUND_UUID = '00000000-0000-4000-8000-000000000004';
const SINGBOX_INBOUND_UUID = '00000000-0000-4000-8000-000000000005';

const xrayBinding = {
    activeConfigProfileUuid: XRAY_PROFILE_UUID,
    activeInbounds: [XRAY_INBOUND_UUID],
};
const singBoxBinding = {
    activeConfigProfileUuid: SINGBOX_PROFILE_UUID,
    activeInbounds: [SINGBOX_INBOUND_UUID],
};

const createBody = {
    address: '127.0.0.1',
    name: 'VMrack',
};

test('create accepts Xray-only, sing-box-only, and concurrent bindings', () => {
    assert.equal(
        CreateNodeCommand.RequestBodySchema.safeParse({
            ...createBody,
            configProfile: xrayBinding,
        }).success,
        true,
    );
    assert.equal(
        CreateNodeCommand.RequestBodySchema.safeParse({
            ...createBody,
            configProfile: null,
            singBoxConfigProfile: singBoxBinding,
        }).success,
        true,
    );
    assert.equal(
        CreateNodeCommand.RequestBodySchema.safeParse({
            ...createBody,
            configProfile: xrayBinding,
            singBoxConfigProfile: null,
        }).success,
        true,
    );
    assert.equal(
        CreateNodeCommand.RequestBodySchema.safeParse({
            ...createBody,
            configProfile: xrayBinding,
            singBoxConfigProfile: singBoxBinding,
        }).success,
        true,
    );
    assert.equal(CreateNodeCommand.RequestBodySchema.safeParse(createBody).success, false);
});

test('update accepts clearing either core without removing the other binding', () => {
    assert.deepEqual(
        UpdateNodeCommand.RequestBodySchema.parse({
            uuid: NODE_UUID,
            configProfile: null,
            singBoxConfigProfile: singBoxBinding,
        }),
        {
            uuid: NODE_UUID,
            configProfile: null,
            singBoxConfigProfile: singBoxBinding,
        },
    );
    assert.deepEqual(
        UpdateNodeCommand.RequestBodySchema.parse({
            uuid: NODE_UUID,
            configProfile: xrayBinding,
            singBoxConfigProfile: null,
        }),
        {
            uuid: NODE_UUID,
            configProfile: xrayBinding,
            singBoxConfigProfile: null,
        },
    );
});

test('start-node assignments keep Xray and sing-box configs and inbounds separate', () => {
    const assignments = getCoreProfileAssignments(
        {
            activeConfigProfileUuid: XRAY_PROFILE_UUID,
            activeSingBoxConfigProfileUuid: SINGBOX_PROFILE_UUID,
            activeInbounds: [
                {
                    uuid: XRAY_INBOUND_UUID,
                    profileUuid: XRAY_PROFILE_UUID,
                    tag: 'vless-lazy',
                },
                {
                    uuid: SINGBOX_INBOUND_UUID,
                    profileUuid: SINGBOX_PROFILE_UUID,
                    tag: 'singbox-hysteria2-test',
                },
            ] as never,
        },
        'all',
    );

    assert.equal(assignments.length, 2);
    assert.deepEqual(
        assignments.map(({ expectedCoreType, profileUuid, activeInbounds }) => ({
            expectedCoreType,
            profileUuid,
            inboundUuids: activeInbounds.map((inbound) => inbound.uuid),
        })),
        [
            {
                expectedCoreType: 'xray',
                profileUuid: XRAY_PROFILE_UUID,
                inboundUuids: [XRAY_INBOUND_UUID],
            },
            {
                expectedCoreType: 'singbox',
                profileUuid: SINGBOX_PROFILE_UUID,
                inboundUuids: [SINGBOX_INBOUND_UUID],
            },
        ],
    );
});
