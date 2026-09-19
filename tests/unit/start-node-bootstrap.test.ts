import assert from 'node:assert/strict';
import test from 'node:test';

test('processor module bootstraps StartNodeProcessor with CertificateProfileService', async () => {
    process.env.INSTANCE_TYPE = 'processor';

    const [
        { Test },
        common,
        axios,
        cqrs,
        events,
        rawCache,
        prisma,
        config,
        nodesModule,
        certificates,
    ] = await Promise.all([
        import('@nestjs/testing'),
        import('@nestjs/common'),
        import('../../src/common/axios/axios.service'),
        import('@nestjs/cqrs'),
        import('@nestjs/event-emitter'),
        import('../../src/common/raw-cache/raw-cache.service'),
        import('../../src/common/database/prisma.service'),
        import('../../src/common/config/app-config/typed-config.service'),
        import('../../src/queue/_nodes/nodes-queues.module'),
        import('../../src/common/certificates/certificate-profile.module'),
    ]);

    const { NodesQueuesModule } = nodesModule;
    const { CertificateProfileModule } = certificates;
    const { NodesQueuesService } = await import('../../src/queue/_nodes/nodes-queues.service');
    const { StartNodeProcessor } =
        await import('../../src/queue/_nodes/processors/start-node.processor');

    assert.ok(NodesQueuesModule.imports?.includes(CertificateProfileModule));

    @common.Global()
    @common.Module({
        providers: [
            { provide: axios.AxiosService, useValue: {} },
            { provide: NodesQueuesService, useValue: {} },
            { provide: cqrs.QueryBus, useValue: {} },
            { provide: events.EventEmitter2, useValue: {} },
            { provide: cqrs.CommandBus, useValue: {} },
            { provide: rawCache.RawCacheService, useValue: {} },
            { provide: prisma.PrismaService, useValue: {} },
            {
                provide: config.TypedConfigService,
                useValue: {
                    get: () => undefined,
                    getOrThrow: () => {
                        throw new Error('configuration is not needed by this bootstrap test');
                    },
                },
            },
        ],
        exports: [
            axios.AxiosService,
            NodesQueuesService,
            cqrs.QueryBus,
            events.EventEmitter2,
            cqrs.CommandBus,
            rawCache.RawCacheService,
            prisma.PrismaService,
            config.TypedConfigService,
        ],
    })
    class BootstrapTestDependencies {}

    const app = await Test.createTestingModule({
        imports: [BootstrapTestDependencies, CertificateProfileModule],
        providers: [StartNodeProcessor],
    }).compile();

    await app.init();

    const processor = app.get(StartNodeProcessor);
    assert.ok(processor);

    await app.close();
});
