import { Logger } from '@nestjs/common';
import { IEventHandler, QueryBus } from '@nestjs/cqrs';
import { EventsHandler } from '@nestjs/cqrs';

import { AddUserCommand as AddUserToNodeCommandSdk } from '@remnawave/node-contract';

import {
    getCipherTypeFromString,
    getSsPassword,
    isSS2022Method,
} from '@common/helpers/xray-config/ss-cipher';
import { getVlessFlowFromDbInbound } from '@common/utils/flow/get-vless-flow';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities/config-profile-inbound.entity';
import { GetUserWithResolvedInboundsQuery } from '@modules/users/queries/get-user-with-resolved-inbounds';

import { NodesQueuesService } from '@queue/_nodes';

import { NodesRepository } from '../../repositories/nodes.repository';
import { AddUserToNodeEvent } from './add-user-to-node.event';

@EventsHandler(AddUserToNodeEvent)
export class AddUserToNodeHandler implements IEventHandler<AddUserToNodeEvent> {
    public readonly logger = new Logger(AddUserToNodeHandler.name);

    constructor(
        private readonly nodesRepository: NodesRepository,
        private readonly nodesQueuesService: NodesQueuesService,
        private readonly queryBus: QueryBus,
    ) {}
    async handle(event: AddUserToNodeEvent) {
        try {
            const userEntity = await this.queryBus.execute(
                new GetUserWithResolvedInboundsQuery(event.userId),
            );

            if (!userEntity.isOk) {
                return;
            }

            const {
                id,
                trojanPassword,
                vlessUuid,
                ssPassword,
                socksUsername,
                socksPassword,
                inbounds,
            } = userEntity.response;

            if (inbounds.length === 0) {
                return;
            }

            const nodes = await this.nodesRepository.findConnectedNodes();

            if (nodes.length === 0) {
                return;
            }

            const userData = {
                hashData: {
                    vlessUuid,
                    prevVlessUuid: event.prevVlessUuid,
                },

                data: inbounds.map((inbound) => {
                    const inboundType = this.resolveInboundType(inbound);

                    switch (inboundType) {
                        case 'trojan':
                            return {
                                type: inboundType,
                                username: id.toString(),
                                password: trojanPassword,
                                tag: inbound.tag,
                            };
                        case 'vless':
                            return {
                                type: inboundType,
                                username: id.toString(),
                                uuid: vlessUuid,
                                flow: getVlessFlowFromDbInbound(inbound),
                                tag: inbound.tag,
                            };
                        case 'shadowsocks':
                            return {
                                type: inboundType,
                                username: id.toString(),
                                password: ssPassword,
                                tag: inbound.tag,
                                cipherType: getCipherTypeFromString(inbound.rawInbound),
                                ivCheck: false,
                            };
                        case 'shadowsocks22':
                            return {
                                type: inboundType,
                                username: id.toString(),
                                password: getSsPassword(ssPassword, true),
                                tag: inbound.tag,
                            };
                        case 'hysteria':
                        case 'hysteria2':
                        case 'anytls':
                            return {
                                type: inboundType,
                                username: id.toString(),
                                password: vlessUuid,
                                tag: inbound.tag,
                            };
                        case 'socks':
                            return {
                                type: inboundType,
                                username: socksUsername,
                                password: socksPassword,
                                tag: inbound.tag,
                            };
                        default:
                            throw new Error(`Unsupported inbound type: ${inboundType}`);
                    }
                }),
            } as unknown as AddUserToNodeCommandSdk.Request;

            for (const node of nodes) {
                if (
                    node.activeInbounds.length === 0 ||
                    (!node.activeConfigProfileUuid && !node.activeSingBoxConfigProfileUuid)
                ) {
                    continue;
                }

                const activeTags = new Set(node.activeInbounds.map((inbound) => inbound.tag));

                if (node.activeInbounds.some((inbound) => inbound.type === 'socks')) {
                    await this.nodesQueuesService.startNode({ nodeUuid: node.uuid });
                    continue;
                }

                const filteredData = {
                    ...userData,
                    data: userData.data.filter((item) => activeTags.has(item.tag)),
                };

                if (filteredData.data.length === 0) {
                    await this.nodesQueuesService.removeUserFromNode({
                        data: {
                            username: id.toString(),
                            hashData: {
                                vlessUuid: event.prevVlessUuid || vlessUuid,
                            },
                        },
                        node: {
                            address: node.address,
                            port: node.port,
                            proxyUrl: node.proxyUrl,
                        },
                    });

                    continue;
                }

                await this.nodesQueuesService.addUserToNode({
                    data: filteredData,
                    node: {
                        address: node.address,
                        port: node.port,
                        proxyUrl: node.proxyUrl,
                    },
                });
            }

            return;
        } catch (error) {
            this.logger.error(`Error in Event AddUserToNodeHandler: ${error}`);
        }
    }

    private resolveInboundType(inbound: ConfigProfileInboundEntity): string {
        if (inbound.type === 'shadowsocks' && isSS2022Method(inbound.rawInbound)) {
            return 'shadowsocks22';
        }
        return inbound.type;
    }
}
