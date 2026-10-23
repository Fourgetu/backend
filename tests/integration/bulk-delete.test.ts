import 'reflect-metadata';
import type { DB } from '../../prisma/generated/types';

import { PrismaTxDriver } from '@kastov/nestjs-prisma-kysely/build/drivers/prisma-tx.driver';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { PrismaClient } from '@prisma/client';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { CustomCamelCasePlugin, JSON_COLUMNS } from '../../src/common/database/camel-case.plugin';
import { TxKyselyService } from '../../src/common/database/tx-kysely.service';
import { UsersRepository } from '../../src/modules/users/repositories/users.repository';
import { UserConverter } from '../../src/modules/users/users.converter';

test('status deletion uses the real Prisma/Kysely driver and PostgreSQL constraints', async (t) => {
    const connection = process.env.BULK_DELETE_TEST_DATABASE_URL;
    assert.ok(connection, 'Set BULK_DELETE_TEST_DATABASE_URL to an isolated clone_test database');
    const url = new URL(connection);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/clone_test');
    assert.equal(url.username, 'clone_test');
    const prisma = new PrismaClient({ datasourceUrl: connection });
    t.after(() => prisma.$disconnect());
    const adapter = new TransactionalAdapterPrisma({ prismaInjectionToken: 'test-prisma' });
    const tx = new TransactionHost<TransactionalAdapterPrisma>(adapter.optionsFactory(prisma));
    const queries: { sql: string; parameters: readonly unknown[] }[] = [];
    const kysely = new Kysely<DB>({
        dialect: {
            createDriver: () => new PrismaTxDriver(tx),
            createAdapter: () => new PostgresAdapter(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
        plugins: [new CustomCamelCasePlugin({ excludeColumns: JSON_COLUMNS })],
        log: (event) => queries.push(event.query),
    });
    const repository = new UsersRepository(tx, new TxKyselyService(kysely), new UserConverter());
    const createUser = (status: string) =>
        prisma.users.create({
            data: {
                shortUuid: randomUUID(),
                username: randomUUID(),
                status,
                expireAt: new Date('2030-01-01'),
                trojanPassword: randomUUID(),
                vlessUuid: randomUUID(),
                ssPassword: randomUUID(),
                traffic: { create: {} },
            },
        });

    await t.test(
        'binds status, honors batch limits and returns actual affected counts',
        async () => {
            await createUser('EXPIRED');
            await createUser('EXPIRED');
            const active = await createUser('ACTIVE');
            assert.equal(await repository.deleteManyByStatus('EXPIRED', 1), 1);
            assert.equal(await prisma.users.count({ where: { status: 'EXPIRED' } }), 1);
            assert.equal(await repository.deleteManyByStatus("EXPIRED' OR 1=1 --" as never), 0);
            const query = queries.at(-1)!;
            assert.ok(!query.sql.includes('OR 1=1'));
            assert.deepEqual(query.parameters, ["EXPIRED' OR 1=1 --", 30000]);
            assert.equal(await repository.deleteManyByStatus('EXPIRED'), 1);
            assert.equal(await repository.deleteManyByStatus('EXPIRED'), 0);
            assert.ok(await prisma.users.findUnique({ where: { id: active.id } }));
        },
    );

    await t.test(
        'cascades user allocations while preserving shared configuration and reusable ports',
        async () => {
            const suffix = randomUUID();
            const profile = await prisma.configProfiles.create({
                data: { name: suffix, coreType: 'singbox', config: {} },
            });
            const inbound = await prisma.configProfileInbounds.create({
                data: { profileUuid: profile.uuid, tag: suffix, type: 'hysteria2', port: 443 },
            });
            const node = await prisma.nodes.create({
                data: { name: suffix, address: `${suffix}.example.com` },
            });
            const host = await prisma.hosts.create({
                data: {
                    remark: suffix,
                    address: 'example.com',
                    port: 443,
                    configProfileUuid: profile.uuid,
                    configProfileInboundUuid: inbound.uuid,
                },
            });
            const speed = await prisma.speedLimits.create({ data: { name: suffix } });
            const hopping = await prisma.portHoppingConfigs.create({
                data: {
                    configProfileInboundUuid: inbound.uuid,
                    poolStart: 20000,
                    poolEnd: 20100,
                    portsPerUser: 10,
                },
            });
            const squad = await prisma.internalSquads.create({ data: { name: suffix } });
            const user = await createUser('DISABLED');
            await prisma.internalSquadMembers.create({
                data: { userId: user.id, internalSquadUuid: squad.uuid },
            });
            const allocation = {
                nodeUuid: node.uuid,
                hostUuid: host.uuid,
                configProfileInboundUuid: inbound.uuid,
                speedLimitUuid: speed.uuid,
                portHoppingConfigUuid: hopping.uuid,
                externalPort: 20000,
                internalPort: 443,
                network: 'udp',
                hopStartPort: 20000,
                hopEndPort: 20009,
            };
            await prisma.userRoutes.create({ data: { ...allocation, userId: user.id } });
            assert.equal(await repository.deleteManyByStatus('DISABLED'), 1);
            assert.equal(await prisma.userTraffic.count({ where: { id: user.id } }), 0);
            assert.equal(
                await prisma.internalSquadMembers.count({ where: { userId: user.id } }),
                0,
            );
            assert.equal(await prisma.userRoutes.count({ where: { userId: user.id } }), 0);
            assert.ok(await prisma.configProfiles.findUnique({ where: { uuid: profile.uuid } }));
            assert.ok(await prisma.nodes.findUnique({ where: { uuid: node.uuid } }));
            assert.ok(await prisma.hosts.findUnique({ where: { uuid: host.uuid } }));
            assert.ok(await prisma.speedLimits.findUnique({ where: { uuid: speed.uuid } }));
            assert.ok(
                await prisma.portHoppingConfigs.findUnique({ where: { uuid: hopping.uuid } }),
            );
            assert.ok(await prisma.internalSquads.findUnique({ where: { uuid: squad.uuid } }));
            const replacement = await createUser('ACTIVE');
            await prisma.userRoutes.create({ data: { ...allocation, userId: replacement.id } });
        },
    );

    await t.test('rolls deletion back with its surrounding transaction', async () => {
        const user = await createUser('LIMITED');
        await assert.rejects(
            tx.withTransaction(async () => {
                assert.equal(await repository.deleteManyByStatus('LIMITED'), 1);
                throw new Error('rollback fixture');
            }),
            /rollback fixture/,
        );
        assert.ok(await prisma.users.findUnique({ where: { id: user.id } }));
        assert.ok(await prisma.userTraffic.findUnique({ where: { id: user.id } }));
    });
});
