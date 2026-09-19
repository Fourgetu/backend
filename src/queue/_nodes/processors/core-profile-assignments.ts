import { CONFIG_PROFILE_CORE_TYPE, TConfigProfileCoreType } from '@libs/contracts/constants';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

interface IConcurrentProfileNode {
    activeConfigProfileUuid: null | string;
    activeInbounds: ConfigProfileInboundEntity[];
    activeSingBoxConfigProfileUuid: null | string;
}

export interface ICoreProfileAssignment {
    activeInbounds: ConfigProfileInboundEntity[];
    expectedCoreType: TConfigProfileCoreType;
    profileUuid: string;
}

export const getCoreProfileAssignments = (
    node: IConcurrentProfileNode,
    runtime: 'all' | 'gost' | 'singbox' | 'xray' = 'all',
): ICoreProfileAssignment[] =>
    [
        node.activeConfigProfileUuid
            ? {
                  profileUuid: node.activeConfigProfileUuid,
                  expectedCoreType: CONFIG_PROFILE_CORE_TYPE.XRAY,
              }
            : null,
        node.activeSingBoxConfigProfileUuid
            ? {
                  profileUuid: node.activeSingBoxConfigProfileUuid,
                  expectedCoreType: CONFIG_PROFILE_CORE_TYPE.SINGBOX,
              }
            : null,
    ]
        .filter((assignment) => assignment !== null)
        .filter((assignment) => runtime === 'all' || assignment.expectedCoreType === runtime)
        .map((assignment) => ({
            ...assignment,
            activeInbounds: node.activeInbounds.filter(
                (inbound) => inbound.profileUuid === assignment.profileUuid,
            ),
        }));
