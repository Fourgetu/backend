import { Logger } from '@nestjs/common';
import { IEventHandler, EventsHandler } from '@nestjs/cqrs';

import { RemoveUserCommand as RemoveUserFromNodeCommandSdk } from '@remnawave/node-contract';

import { isSS2022Method } from '@common/helpers/xray-config/ss-cipher';

import { NodesQueuesService } from '@queue/_nodes';

import { NodesRepository } from '../../repositories/nodes.repository';
import { RemoveUserFromNodeEvent } from './remove-user-from-node.event';

@EventsHandler(RemoveUserFromNodeEvent)
export class RemoveUserFromNodeHandler implements IEventHandler<RemoveUserFromNodeEvent> {
    public readonly logger = new Logger(RemoveUserFromNodeHandler.name);

    constructor(
        private readonly nodesRepository: NodesRepository,
        private readonly nodesQueuesService: NodesQueuesService,
    ) {}
    async handle(event: RemoveUserFromNodeEvent) {
        try {
            const nodes = await this.nodesRepository.findConnectedNodes();

            if (nodes.length === 0) {
                return;
            }

            const userData: RemoveUserFromNodeCommandSdk.Request = {
                username: event.id.toString(),
                hashData: {
                    vlessUuid: event.vlessUuid,
                },
            };

            const dynamicNodes = nodes.filter(
                (node) =>
                    !node.activeInbounds.some(
                        (inbound) => inbound.type === 'socks' || isSS2022Method(inbound.rawInbound),
                    ),
            );
            const restartNodes = nodes.filter((node) =>
                node.activeInbounds.some(
                    (inbound) => inbound.type === 'socks' || isSS2022Method(inbound.rawInbound),
                ),
            );

            await this.nodesQueuesService.removeUserFromNodeBulk(
                dynamicNodes.map((node) => ({
                    data: userData,
                    node: {
                        address: node.address,
                        port: node.port,
                        proxyUrl: node.proxyUrl,
                    },
                })),
            );
            for (const node of restartNodes) {
                await this.nodesQueuesService.startNode({ nodeUuid: node.uuid });
            }

            return;
        } catch (error) {
            this.logger.error(`Error in Event RemoveUserFromNodeHandler: ${error}`);
        }
    }
}
