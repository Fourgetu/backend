import 'reflect-metadata';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { CloneHostCommand } from '../../libs/contract/commands/hosts/clone.command';
import { ERRORS } from '../../libs/contract/constants';
import { HostsConverter } from '../../src/modules/hosts/hosts.converter';
import { HostsService } from '../../src/modules/hosts/hosts.service';
import { HostResponseModel } from '../../src/modules/hosts/models/host.response.model';
import { HostsRepository } from '../../src/modules/hosts/repositories/hosts.repository';

test('Host cloning uses a real PostgreSQL transaction', async (t) => {
    const connection = process.env.HOST_CLONE_TEST_DATABASE_URL;
    assert.ok(connection, 'Set HOST_CLONE_TEST_DATABASE_URL to an isolated clone_test database');
    const url = new URL(connection);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/clone_test');
    assert.equal(url.username, 'clone_test');
    const prisma = new PrismaClient({ datasourceUrl: connection });
    t.after(() => prisma.$disconnect());
    const adapter = new TransactionalAdapterPrisma({ prismaInjectionToken: 'test-prisma' });
    const tx = new TransactionHost<TransactionalAdapterPrisma>({
        ...adapter.optionsFactory(prisma),
    });
    const repository = new HostsRepository(tx, {} as never, new HostsConverter());
    const service = new HostsService(repository, {} as never);

    const createSource = async (coreType = 'xray') => {
        const suffix = randomUUID();
        const profile = await prisma.configProfiles.create({
            data: { name: suffix, coreType, config: { custom: { retained: true } } },
        });
        const inbound = await prisma.configProfileInbounds.create({
            data: {
                profileUuid: profile.uuid,
                tag: suffix,
                type: coreType === 'xray' ? 'vless' : 'hysteria2',
                port: 443,
            },
        });
        const node = await prisma.nodes.create({
            data: { name: suffix, address: `${suffix}.example.com` },
        });
        const squad = await prisma.internalSquads.create({ data: { name: suffix } });
        return prisma.hosts.create({
            data: {
                remark: `Source ${coreType}`,
                address: 'public.example.com',
                port: 32001,
                configProfileUuid: profile.uuid,
                configProfileInboundUuid: inbound.uuid,
                tags: ['CUSTOM'],
                vlessRouteId: 42,
                sni: 'tls.example.com',
                internalSquadsMode: 'ALLOW_ONLY',
                finalMask: {
                    quicParams: { udpHop: { ports: '20000-20019', interval: '30s' } },
                    unknownField: 'keep',
                },
                sockoptParams: { mark: 123 },
                muxParams: { enabled: true },
                xhttpExtraParams: { custom: 'keep' },
                nodes: { create: { nodeUuid: node.uuid } },
                internalSquads: { create: { squadUuid: squad.uuid } },
            },
        });
    };
    const include = { nodes: true, internalSquads: true };

    for (const coreType of ['xray', 'singbox']) {
        await t.test(
            `clones ${coreType} fields, relations and order with a disabled new UUID`,
            async () => {
                const source = await createSource(coreType);
                const next = await prisma.hosts.create({
                    data: { remark: 'Next', address: 'next.example.com', port: 443 },
                });
                const result = await service.cloneHost(source.uuid);
                assert.equal(result.isOk, true);
                if (!result.isOk) throw new Error('Clone failed');
                assert.notEqual(result.response.uuid, source.uuid);
                const clone = await prisma.hosts.findUniqueOrThrow({
                    where: { uuid: result.response.uuid },
                    include,
                });
                for (const [key, value] of Object.entries(source)) {
                    if (['uuid', 'remark', 'viewPosition', 'isDisabled'].includes(key)) continue;
                    assert.deepEqual(clone[key as keyof typeof clone], value, key);
                }
                assert.equal(clone.isDisabled, true);
                assert.match(clone.remark, /^#_/);
                assert.equal(clone.viewPosition, source.viewPosition + 1);
                assert.equal(
                    (await prisma.hosts.findUniqueOrThrow({ where: { uuid: next.uuid } }))
                        .viewPosition,
                    next.viewPosition + 1,
                );
                const original = await prisma.hosts.findUniqueOrThrow({
                    where: { uuid: source.uuid },
                    include,
                });
                assert.deepEqual(
                    clone.nodes.map((row) => row.nodeUuid),
                    original.nodes.map((row) => row.nodeUuid),
                );
                assert.deepEqual(
                    clone.internalSquads.map((row) => row.squadUuid),
                    original.internalSquads.map((row) => row.squadUuid),
                );
                CloneHostCommand.ResponseSchema.parse({
                    response: new HostResponseModel(result.response),
                });
            },
        );
    }

    await t.test(
        'association failure rolls back inserted host, copied links and shifted positions',
        async () => {
            const source = await createSource();
            await prisma.hosts.create({
                data: { remark: 'After failure', address: 'after.example.com', port: 443 },
            });
            const before = await prisma.hosts.findMany({ orderBy: { uuid: 'asc' }, include });
            const failure = t.mock.method(repository, 'addInternalSquadsToHost', async () => {
                throw new Error('Injected association failure');
            });
            try {
                const result = await service.cloneHost(source.uuid);
                assert.equal(result.isOk, false);
                assert.deepEqual(
                    await prisma.hosts.findMany({ orderBy: { uuid: 'asc' }, include }),
                    before,
                );
            } finally {
                failure.mock.restore();
            }
        },
    );

    await t.test('concurrent clones reserve distinct adjacent positions', async () => {
        const source = await createSource();
        const results = await Promise.all(
            Array.from({ length: 3 }, () => service.cloneHost(source.uuid)),
        );
        assert.ok(results.every((result) => result.isOk));
        const ids = results.map((result) => (result.isOk ? result.response.uuid : ''));
        const clones = await prisma.hosts.findMany({
            where: { uuid: { in: ids } },
            orderBy: { viewPosition: 'asc' },
        });
        assert.deepEqual(
            clones.map((clone) => clone.viewPosition),
            [1, 2, 3].map((offset) => source.viewPosition + offset),
        );
    });

    await t.test('missing and detached sources cannot create a clone', async () => {
        const detached = await prisma.hosts.create({
            data: { remark: 'Detached', address: 'detached.example.com', port: 443 },
        });
        const before = await prisma.hosts.count();
        assert.equal((await service.cloneHost(randomUUID())).isOk, false);
        assert.equal((await service.cloneHost(detached.uuid)).isOk, false);
        assert.equal(await prisma.hosts.count(), before);
        assert.notEqual(ERRORS.CLONE_HOST_ERROR.code as string, ERRORS.SPEED_LIMIT_NOT_FOUND.code);
    });
});
