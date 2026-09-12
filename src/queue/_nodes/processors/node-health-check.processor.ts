import { Job } from 'bullmq';

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { GetSystemStatsCommand } from '@remnawave/node-contract';

import { AxiosService, INodeConnectionOpts } from '@common/axios';
import { PrismaService } from '@common/database/prisma.service';
import { reconcileGostForwards } from '@common/gost-runtime/reconcile-gost-forwards';
import { RawCacheService } from '@common/raw-cache';
import { CACHE_KEYS, CACHE_KEYS_TTL, EVENTS } from '@libs/contracts/constants';

import { NodeEvent } from '@integration-modules/notifications/interfaces';

import { UpdateNodeCommand } from '@modules/nodes/commands/update-node';
import { INodeRuntimeHealth, INodeVersions } from '@modules/nodes/interfaces';

import { NodesQueuesService } from '@queue/_nodes';
import { QUEUES_NAMES } from '@queue/queue.enum';

import { NODES_JOB_NAMES } from '../constants/nodes-job-name.constant';
import { INodeHealthCheckPayload } from '../interfaces';

@Processor(QUEUES_NAMES.NODES.HEALTH_CHECK, {
    concurrency: 40,
})
export class NodeHealthCheckQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(NodeHealthCheckQueueProcessor.name);

    constructor(
        private readonly commandBus: CommandBus,
        private readonly eventEmitter: EventEmitter2,
        private readonly axios: AxiosService,
        private readonly nodesQueuesService: NodesQueuesService,
        private readonly rawCacheService: RawCacheService,
        private readonly prisma: PrismaService,
    ) {
        super();
    }
    async process(job: Job<INodeHealthCheckPayload>) {
        try {
            const { nodeUuid, isConnected, connectionOpts } = job.data;

            const attemptsLimit = 2;
            let attempts = 0;

            let message = '';

            while (attempts < attemptsLimit) {
                const statResult = await this.axios.getSystemStats(connectionOpts);

                switch (statResult.isOk) {
                    case true:
                        return await this.handleConnectedNode(
                            connectionOpts,
                            nodeUuid,
                            isConnected,
                            statResult.response,
                        );
                    case false:
                        message = statResult.message ?? 'Unknown error';
                        attempts++;

                        this.logger.warn(
                            `Node ${nodeUuid}, ${connectionOpts.address}:${connectionOpts.port} – health check attempt ${attempts} of ${attemptsLimit}, message: ${message}`,
                        );

                        continue;
                    default:
                        message = 'Unknown error';
                        this.logger.error(
                            `Node ${nodeUuid}, ${connectionOpts.address}:${connectionOpts.port} – health check attempt ${attempts} of ${attemptsLimit}, message: ${message}`,
                        );

                        attempts++;
                        continue;
                }
            }

            return await this.handleDisconnectedNode(nodeUuid, isConnected, message);
        } catch (error) {
            this.logger.error(
                `Error handling "${NODES_JOB_NAMES.NODE_HEALTH_CHECK}" job: ${error}`,
            );
            return;
        }
    }

    private async handleConnectedNode(
        connectionOpts: INodeConnectionOpts,
        nodeUuid: string,
        isConnected: boolean,
        stats: GetSystemStatsCommand.Response['response'],
    ) {
        const nodeHealthResult = await this.axios.getNodeHealth(connectionOpts);
        const advertisedHealth = nodeHealthResult.isOk
            ? (nodeHealthResult.response as typeof nodeHealthResult.response & {
                  cores?: {
                      xray: { online: boolean; version: string | null };
                      singbox: { online: boolean; version: string | null };
                      gost: {
                          online: boolean;
                          version: string | null;
                          installed: boolean;
                          services: number;
                      };
                  };
              })
            : undefined;
        const observedAt = new Date().toISOString();
        const runtimeHealth: INodeRuntimeHealth = advertisedHealth?.cores
            ? {
                  observedAt,
                  xray: {
                      status: advertisedHealth.cores.xray.online ? 'running' : 'stopped',
                      version: advertisedHealth.cores.xray.version,
                  },
                  singbox: {
                      status: advertisedHealth.cores.singbox.online ? 'running' : 'stopped',
                      version: advertisedHealth.cores.singbox.version,
                  },
                  gost: {
                      status: !advertisedHealth.cores.gost.installed
                          ? 'unavailable'
                          : advertisedHealth.cores.gost.online
                            ? 'running'
                            : 'stopped',
                      version: advertisedHealth.cores.gost.version,
                      installed: advertisedHealth.cores.gost.installed,
                      services: advertisedHealth.cores.gost.services,
                  },
              }
            : {
                  observedAt,
                  xray: {
                      status: stats.xrayInfo === null ? 'unknown' : 'running',
                      version: advertisedHealth?.xrayVersion ?? null,
                  },
                  singbox: { status: 'unknown', version: null },
                  gost: {
                      status: 'unknown',
                      version: null,
                      installed: null,
                      services: null,
                  },
              };
        const currentVersions = await this.rawCacheService.get<INodeVersions>(
            CACHE_KEYS.NODE_VERSIONS(nodeUuid),
        );
        const xrayVersion = runtimeHealth.xray.version ?? currentVersions?.xray;
        const nodeVersion = advertisedHealth?.nodeVersion ?? currentVersions?.node;
        const versions =
            xrayVersion && nodeVersion
                ? {
                      xray: xrayVersion,
                      ...(runtimeHealth.singbox.version
                          ? { singbox: runtimeHealth.singbox.version }
                          : currentVersions?.singbox
                            ? { singbox: currentVersions.singbox }
                            : {}),
                      ...(runtimeHealth.gost.version
                          ? { gost: runtimeHealth.gost.version }
                          : currentVersions?.gost
                            ? { gost: currentVersions.gost }
                            : {}),
                      node: nodeVersion,
                  }
                : null;

        await this.rawCacheService.setMany([
            {
                key: CACHE_KEYS.NODE_SYSTEM_STATS(nodeUuid),
                value: stats.system.stats,
                ttlSeconds: CACHE_KEYS_TTL.NODE_SYSTEM_STATS,
            },
            {
                key: CACHE_KEYS.NODE_XRAY_UPTIME(nodeUuid),
                value: stats.xrayInfo?.uptime ?? 0,
                ttlSeconds: CACHE_KEYS_TTL.NODE_XRAY_UPTIME,
            },
            {
                key: CACHE_KEYS.NODE_RUNTIME_HEALTH(nodeUuid),
                value: runtimeHealth,
                ttlSeconds: CACHE_KEYS_TTL.NODE_RUNTIME_HEALTH,
            },
            ...(versions
                ? [
                      {
                          key: CACHE_KEYS.NODE_VERSIONS(nodeUuid),
                          value: versions,
                      },
                  ]
                : []),
        ]);

        const reports = stats.plugins.torrentBlocker.reportsCount;
        if (reports !== undefined && reports > 0) {
            await this.nodesQueuesService.collectReports({
                nodeUuid,
                connectionOpts,
            });

            this.logger.log(`Node ${nodeUuid} has ${reports} reports, collecting reports...`);
        }

        if (!isConnected) {
            const nodeUpdatedResponse = await this.commandBus.execute(
                new UpdateNodeCommand({
                    uuid: nodeUuid,
                    isConnected: true,
                }),
            );

            if (!nodeUpdatedResponse.isOk) {
                return;
            }

            await this.nodesQueuesService.startNode({ nodeUuid });

            const gostResult = await reconcileGostForwards(
                this.prisma,
                this.axios,
                nodeUuid,
                connectionOpts,
            );
            if (!gostResult.isOk || !gostResult.response.applied) {
                this.logger.warn(
                    `GOST reconnect reconcile skipped for node ${nodeUuid}: ${
                        gostResult.isOk
                            ? (gostResult.response.error ?? 'runtime rejected configuration')
                            : (gostResult.message ?? 'node runtime unavailable')
                    }`,
                );
            }

            this.eventEmitter.emit(
                EVENTS.NODE.CONNECTION_RESTORED,
                new NodeEvent(nodeUpdatedResponse.response, EVENTS.NODE.CONNECTION_RESTORED),
            );
        }

        return;
    }

    private async handleDisconnectedNode(
        nodeUuid: string,
        isConnected: boolean,
        message: string | undefined,
    ) {
        await this.rawCacheService.delMany([
            CACHE_KEYS.NODE_SYSTEM_INFO(nodeUuid),
            CACHE_KEYS.NODE_USERS_ONLINE(nodeUuid),
            CACHE_KEYS.NODE_XRAY_UPTIME(nodeUuid),
            CACHE_KEYS.NODE_RUNTIME_HEALTH(nodeUuid),
        ]);

        const newNodeEntity = await this.commandBus.execute(
            new UpdateNodeCommand({
                uuid: nodeUuid,
                isConnected: false,
                lastStatusChange: new Date(),
                lastStatusMessage: message,
            }),
        );

        if (!newNodeEntity.isOk) {
            return;
        }

        await this.nodesQueuesService.startNode({ nodeUuid });

        if (isConnected) {
            this.eventEmitter.emit(
                EVENTS.NODE.CONNECTION_LOST,
                new NodeEvent(newNodeEntity.response, EVENTS.NODE.CONNECTION_LOST),
            );
        }

        this.logger.warn(
            `Lost connection to Node ${nodeUuid}, ${newNodeEntity.response.address}:${newNodeEntity.response.port}, message: ${message}`,
        );

        return;
    }
}
