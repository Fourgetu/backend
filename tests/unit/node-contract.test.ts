import assert from 'node:assert/strict';
import test from 'node:test';

import { StartXrayCommand } from '@remnawave/node-contract';

const baseRequest = {
    coreType: 'xray' as const,
    internals: {
        hashes: {
            emptyConfig: 'empty',
            inbounds: [],
        },
    },
    xrayConfig: {},
};

test('local node contract accepts legacy requests without certificates', () => {
    assert.doesNotThrow(() => StartXrayCommand.RequestSchema.parse(baseRequest));
});

test('local node contract accepts managed certificates', () => {
    const result = StartXrayCommand.RequestSchema.parse({
        ...baseRequest,
        internals: {
            ...baseRequest.internals,
            certificates: [
                {
                    id: 'panel',
                    hash: 'a'.repeat(64),
                    certificate: 'certificate',
                    privateKey: 'private-key',
                },
            ],
        },
    });

    assert.equal(result.internals.certificates?.[0]?.privateKey, 'private-key');
});

test('local node contract rejects malformed certificates', () => {
    assert.throws(() =>
        StartXrayCommand.RequestSchema.parse({
            ...baseRequest,
            internals: {
                ...baseRequest.internals,
                certificates: [
                    {
                        id: 'panel',
                        hash: 'invalid',
                        certificate: '',
                        privateKey: '',
                    },
                ],
            },
        }),
    );
});
