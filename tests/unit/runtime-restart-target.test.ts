import assert from 'node:assert/strict';
import test from 'node:test';

import { RestartNodeCommand } from '../../libs/contract/commands/nodes/actions/restart.command';
import { NodesService } from '../../src/modules/nodes/nodes.service';

test('restart contract preserves legacy all-runtime requests and accepts admin targets', () => {
    assert.deepEqual(RestartNodeCommand.RequestBodySchema.parse({ forceRestart: false }), {
        forceRestart: false,
    });
    assert.deepEqual(
        RestartNodeCommand.RequestBodySchema.parse({ forceRestart: true, runtime: 'singbox' }),
        { forceRestart: true, runtime: 'singbox' },
    );
});

test('targeted restart queues only the requested runtime', async () => {
    const queued: unknown[] = [];
    const context = {
        nodesRepository: {
            findByUUID: async () => ({ uuid: 'node-a', isDisabled: false }),
        },
        nodesQueuesService: {
            startNode: async (payload: unknown) => queued.push(payload),
        },
        logger: { error: () => undefined },
    };

    const result = await NodesService.prototype.restartNode.call(
        context as never,
        'node-a',
        true,
        'xray',
    );

    assert.equal(result.isOk, true);
    assert.deepEqual(queued, [{ nodeUuid: 'node-a', force: true, runtime: 'xray' }]);
});
