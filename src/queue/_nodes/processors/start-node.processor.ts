import { Job } from 'bullmq';
import semver from 'semver';

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { StartXrayCommand } from '@remnawave/node-contract';

import { AxiosService } from '@common/axios/axios.service';
import { PrismaService } from '@common/database/prisma.service';
import { reconcileGostForwards } from '@common/gost-runtime/reconcile-gost-forwards';
import { RawCacheService } from '@common/raw-cache';
import { formatExecutionTime, getTime } from '@common/utils/get-elapsed-time';
import { CACHE_KEYS, CACHE_KEYS_TTL, EVENTS } from '@libs/contracts/constants';

import { NodeEvent } from '@integration-modules/notifications/interfaces';

import { GetResolvedIntegrationsQuery } from '@modules/node-integrations/queries/get-resolved-integrations';
import { mergeNodeIntegrations } from '@modules/node-integrations/utils';
import { GetPluginByUuidQuery } from '@modules/node-plugins/queries/get-plugin-by-uuid';
import { UpdateNodeCommand } from '@modules/nodes/commands/update-node';
import { GetNodeByUuidQuery } from '@modules/nodes/queries/get-node-by-uuid';
import { GetPreparedConfigWithUsersQuery } from '@modules/users/queries/get-prepared-config-with-users';

import { QUEUES_NAMES } from '@queue/queue.enum';

import { NODES_JOB_NAMES } from '../constants/nodes-job-name.constant';
import { NodesQueuesService } from '../nodes-queues.service';
import { getCoreProfileAssignments } from './core-profile-assignments';

@Processor(QUEUES_NAMES.NODES.START, {
    concurrency: 40,
})
export class StartNodeProcessor extends WorkerHost {
    private readonly logger = new Logger(StartNodeProcessor.name);

    constructor(
        private readonly axios: AxiosService,
        private readonly nodesQueuesService: NodesQueuesService,
        private readonly queryBus: QueryBus,
        private readonly eventEmitter: EventEmitter2,
        private readonly commandBus: CommandBus,
        private readonly rawCacheService: RawCacheService,
        private readonly prisma: PrismaService,
    ) {
        super();
    }

    async process(
        job: Job<{
            nodeUuid: string;
            force?: boolean;
            runtime?: 'all' | 'gost' | 'singbox' | 'xray';
        }>,
    ) {
        try {
            const { nodeUuid, force, runtime = 'all' } = job.data;

            const nodeCheckup = await this.queryBus.execute(new GetNodeByUuidQuery(nodeUuid));

            if (!nodeCheckup.isOk) {
                this.logger.error(`Node ${nodeUuid} not found`);
                return;
            }

            const { response: node } = nodeCheckup;

            if (node.isConnecting) {
                return;
            }

            await this.rawCacheService.delMany([
                CACHE_KEYS.NODE_SYSTEM_STATS(nodeUuid),
                CACHE_KEYS.NODE_USERS_ONLINE(nodeUuid),
                CACHE_KEYS.NODE_XRAY_UPTIME(nodeUuid),
            ]);

            if (
                node.activeInbounds.length === 0 ||
                (!node.activeConfigProfileUuid && !node.activeSingBoxConfigProfileUuid)
            ) {
                this.logger.warn(
                    `Node ${nodeUuid} has no active config profile or inbounds, disabling and clearing profile from node...`,
                );

                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        isDisabled: true,
                        activeConfigProfileUuid: null,
                        activeSingBoxConfigProfileUuid: null,
                        isConnecting: false,
                        isConnected: false,
                        lastStatusMessage: null,
                        lastStatusChange: new Date(),
                    }),
                );

                await this.nodesQueuesService.stopNode({
                    nodeUuid: node.uuid,
                    isNeedToBeDeleted: false,
                });

                return;
            }

            await this.commandBus.execute(
                new UpdateNodeCommand({
                    uuid: node.uuid,
                    isConnecting: true,
                }),
            );

            const xrayStatusResponse = await this.axios.getNodeHealth({
                address: node.address,
                port: node.port,
                proxyUrl: node.proxyUrl,
            });

            if (!xrayStatusResponse.isOk) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        lastStatusMessage: xrayStatusResponse.message ?? null,
                        lastStatusChange: new Date(),
                        isConnected: false,
                        isConnecting: false,
                    }),
                );

                this.logger.error(
                    `Pre-check failed. Node: ${node.uuid} – ${node.address}:${node.port}, error: ${xrayStatusResponse.message}`,
                );

                return;
            }

            if (semver.lt(xrayStatusResponse.response.nodeVersion, '2.7.0')) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        lastStatusMessage: `Outdated version ${xrayStatusResponse.response.nodeVersion} of Remnawave Node. Please upgrade to the latest version (>= 2.7.0).`,
                        lastStatusChange: new Date(),
                        isConnected: false,
                        isConnecting: false,
                    }),
                );

                this.logger.error(
                    `Outdated version ${xrayStatusResponse.response.nodeVersion} of Remnawave Node. Please upgrade to the latest version (>= 2.7.0).`,
                );

                return;
            }

            if (runtime === 'gost') {
                const gostResult = await reconcileGostForwards(this.prisma, this.axios, node.uuid, {
                    address: node.address,
                    port: node.port,
                    proxyUrl: node.proxyUrl,
                });
                const gostFailed =
                    !gostResult.isOk ||
                    !gostResult.response.applied ||
                    (gostResult.response.requiresPortHopping &&
                        !gostResult.response.portHopping.applied);
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        isConnecting: false,
                        lastStatusMessage: gostFailed
                            ? gostResult.isOk
                                ? (gostResult.response.error ??
                                  gostResult.response.portHopping.error ??
                                  'GOST rejected the desired state')
                                : (gostResult.message ?? 'GOST sync failed')
                            : null,
                        lastStatusChange: new Date(),
                    }),
                );
                return;
            }

            let plugin: {
                uuid: string;
                config: Record<string, unknown>;
                name: string;
            } | null = null;

            if (node.activePluginUuid) {
                const getNodePluginResult = await this.queryBus.execute(
                    new GetPluginByUuidQuery(node.activePluginUuid),
                );

                if (!getNodePluginResult.isOk) {
                    this.logger.error(`Failed to get node plugin: ${getNodePluginResult.message}`);
                    return;
                }
                const { response: nodePlugin } = getNodePluginResult;
                plugin = {
                    uuid: nodePlugin.uuid,
                    config: nodePlugin.pluginConfig as Record<string, unknown>,
                    name: nodePlugin.name,
                };
            }

            const syncNodePluginsResponse = await this.axios.syncNodePlugins(
                {
                    plugin,
                },
                {
                    address: node.address,
                    port: node.port,
                    proxyUrl: node.proxyUrl,
                },
            );

            if (!syncNodePluginsResponse.isOk) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        isConnecting: false,
                        isConnected: false,
                        lastStatusMessage: `Failed to sync node plugins: ${syncNodePluginsResponse.message}`,
                        lastStatusChange: new Date(),
                    }),
                );

                this.logger.error(
                    `Failed to sync node plugins: ${syncNodePluginsResponse.message}`,
                );
                return;
            }

            const integrationsResult = await this.queryBus.execute(
                new GetResolvedIntegrationsQuery(node.integrationUuids),
            );

            if (!integrationsResult.isOk) {
                throw new Error('Failed to resolve integrations for node');
            }

            const nodeIntegrations = mergeNodeIntegrations(
                node.integrationUuids
                    .map((uuid) => integrationsResult.response.get(uuid))
                    .filter((integration) => integration !== undefined),
            );

            const healthWithCores =
                xrayStatusResponse.response as typeof xrayStatusResponse.response & {
                    cores?: {
                        singbox: { version: null | string };
                        gost: { version: null | string };
                    };
                };
            if (node.activeSingBoxConfigProfileUuid && !healthWithCores.cores) {
                throw new Error(
                    'This Node does not advertise concurrent-core support; upgrade it before assigning a sing-box profile.',
                );
            }

            const assignments = getCoreProfileAssignments(node, runtime);

            const startedVersions: { xray?: string; singbox?: string; node?: string } = {};
            const runtimeErrors: string[] = [];
            let latestSystem: StartXrayCommand.Response['response']['system'] | undefined;

            for (const assignment of assignments) {
                const startTime = getTime();
                const config = await this.queryBus.execute(
                    new GetPreparedConfigWithUsersQuery(
                        assignment.profileUuid,
                        assignment.activeInbounds,
                    ),
                );

                this.logger.log(
                    `Generated ${assignment.expectedCoreType} config for node in ${formatExecutionTime(startTime)}`,
                );

                if (!config.isOk) {
                    runtimeErrors.push(`${assignment.expectedCoreType}: failed to build config`);
                    continue;
                }
                if (config.response.coreType !== assignment.expectedCoreType) {
                    runtimeErrors.push(
                        `${assignment.expectedCoreType}: profile ${assignment.profileUuid} has core type ${config.response.coreType}`,
                    );
                    continue;
                }

                const reqStartTime = getTime();
                const startResult = await this.axios.startXray(
                    {
                        coreType: config.response.coreType,
                        xrayConfig: config.response.config as Record<string, unknown>,
                        internals: {
                            hashes: config.response.hashesPayload,
                            forceRestart: force ?? false,
                            metadata: {
                                uuid: node.uuid,
                                name: node.name,
                                countryCode: node.countryCode,
                                id: Number(node.id),
                                tags: node.tags,
                            },
                            integrations: nodeIntegrations,
                        },
                    },
                    {
                        address: node.address,
                        port: node.port,
                        proxyUrl: node.proxyUrl,
                    },
                );

                this.logger.log(
                    `Started ${assignment.expectedCoreType} in ${formatExecutionTime(reqStartTime)}`,
                );

                if (!startResult.isOk || !startResult.response.isStarted) {
                    runtimeErrors.push(
                        `${assignment.expectedCoreType}: ${
                            startResult.isOk
                                ? (startResult.response.error ?? 'runtime failed to start')
                                : (startResult.message ?? 'node request failed')
                        }`,
                    );
                    continue;
                }

                latestSystem = startResult.response.system;
                startedVersions[assignment.expectedCoreType] =
                    startResult.response.version ?? undefined;
                startedVersions.node = startResult.response.nodeInformation.version ?? undefined;
            }

            const isAnyCoreStarted = Boolean(startedVersions.xray || startedVersions.singbox);
            const allAssignedCoresStarted = runtimeErrors.length === 0 && isAnyCoreStarted;
            const xrayVersion = startedVersions.xray ?? xrayStatusResponse.response.xrayVersion;
            const singboxVersion =
                startedVersions.singbox ?? healthWithCores.cores?.singbox.version ?? undefined;
            const gostVersion = healthWithCores.cores?.gost.version ?? undefined;

            if (latestSystem)
                await this.rawCacheService.setMany([
                    {
                        key: CACHE_KEYS.NODE_SYSTEM_INFO(node.uuid),
                        value: latestSystem.info,
                    },
                    {
                        key: CACHE_KEYS.NODE_VERSIONS(node.uuid),
                        value:
                            startedVersions.node && xrayVersion
                                ? {
                                      xray: xrayVersion,
                                      ...(singboxVersion ? { singbox: singboxVersion } : {}),
                                      ...(gostVersion ? { gost: gostVersion } : {}),
                                      node: startedVersions.node,
                                  }
                                : null,
                    },
                    {
                        key: CACHE_KEYS.NODE_SYSTEM_STATS(node.uuid),
                        value: latestSystem.stats,
                        ttlSeconds: CACHE_KEYS_TTL.NODE_SYSTEM_STATS,
                    },
                ]);

            const updateNodeResult = await this.commandBus.execute(
                new UpdateNodeCommand({
                    uuid: node.uuid,
                    isConnected:
                        runtime === 'all' ? isAnyCoreStarted : node.isConnected || isAnyCoreStarted,
                    lastStatusMessage: runtimeErrors.length > 0 ? runtimeErrors.join(' | ') : null,
                    lastStatusChange: new Date(),
                    isConnecting: false,
                }),
            );

            if (!updateNodeResult.isOk) {
                this.logger.error(`Failed to update node ${node.uuid}`);
                return;
            }

            if (isAnyCoreStarted && runtime === 'all') {
                const gostResult = await reconcileGostForwards(this.prisma, this.axios, node.uuid, {
                    address: node.address,
                    port: node.port,
                    proxyUrl: node.proxyUrl,
                });
                if (
                    !gostResult.isOk ||
                    !gostResult.response.applied ||
                    (gostResult.response.requiresPortHopping &&
                        !gostResult.response.portHopping.applied)
                ) {
                    this.logger.warn(
                        `GOST post-start reconcile skipped for node ${node.uuid}: ${
                            gostResult.isOk
                                ? (gostResult.response.error ??
                                  gostResult.response.portHopping.error ??
                                  'runtime rejected configuration')
                                : (gostResult.message ?? 'node runtime unavailable')
                        }`,
                    );
                }
            }

            if (!node.isConnected && allAssignedCoresStarted) {
                this.eventEmitter.emit(
                    EVENTS.NODE.CONNECTION_RESTORED,
                    new NodeEvent(updateNodeResult.response, EVENTS.NODE.CONNECTION_RESTORED),
                );
            }

            return;
        } catch (error) {
            this.logger.error(`Error handling "${NODES_JOB_NAMES.START_NODE}" job: ${error}`);
            await this.commandBus.execute(
                new UpdateNodeCommand({
                    uuid: job.data.nodeUuid,
                    isConnecting: false,
                    isConnected: false,
                    lastStatusMessage: error instanceof Error ? error.message : String(error),
                    lastStatusChange: new Date(),
                }),
            );
        }
    }
}
