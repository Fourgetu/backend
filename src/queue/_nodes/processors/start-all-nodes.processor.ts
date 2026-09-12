import { Job } from 'bullmq';

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Scope } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { FindNodesByCriteriaQuery } from '@modules/nodes/queries/find-nodes-by-criteria';

import { NodesQueuesService } from '@queue/_nodes';

import { QUEUES_NAMES } from '../../queue.enum';
import { NODES_JOB_NAMES } from '../constants';

@Processor(
    {
        name: QUEUES_NAMES.NODES.START_ALL_NODES,
        scope: Scope.REQUEST,
    },
    {
        concurrency: 1,
    },
)
export class StartAllNodesQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(StartAllNodesQueueProcessor.name);

    constructor(
        private readonly nodesQueuesService: NodesQueuesService,
        private readonly queryBus: QueryBus,
    ) {
        super();
    }

    async process(job: Job) {
        switch (job.name) {
            case NODES_JOB_NAMES.START_ALL_NODES:
                return await this.handleStartAllNodes(job);
            default:
                this.logger.warn(`Job "${job.name}" is not handled.`);
                break;
        }
    }

    private async handleStartAllNodes(job: Job<{ emitter: string; force?: boolean }>) {
        try {
            const result = await this.queryBus.execute(
                new FindNodesByCriteriaQuery({
                    isDisabled: false,
                }),
            );

            if (!result.isOk) {
                return;
            }

            const forceRestart = job.data.force;

            if (forceRestart) {
                this.logger.warn('Force restart all nodes requested.');
            }

            for (const node of result.response) {
                if (!node.activeConfigProfileUuid && !node.activeSingBoxConfigProfileUuid) {
                    this.logger.warn(`Node "${node.uuid}" has no active core profile`);
                    continue;
                }
                await this.nodesQueuesService.startNode({
                    nodeUuid: node.uuid,
                    force: forceRestart,
                });
            }
        } catch (error) {
            this.logger.error(`Error handling "${NODES_JOB_NAMES.START_ALL_NODES}" job: ${error}`);
        }
    }
}
