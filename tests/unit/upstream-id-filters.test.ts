import {
    CamelCasePlugin,
    DummyDriver,
    Kysely,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';
import assert from 'node:assert/strict';
import test from 'node:test';

import { TorrentBlockerReportsRepository } from '../../src/modules/node-plugins/repositories/torrent-blocker-report.repository';
import { UsersRepository } from '../../src/modules/users/repositories/users.repository';

// Compile real repository queries without connecting to a database.
const db = new Kysely<{
    users: { id: bigint; telegramId: bigint | null };
    torrentBlockerReports: { id: bigint; userId: bigint; nodeId: bigint };
}>({
    dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (database) => new PostgresIntrospector(database),
        createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins: [new CamelCasePlugin()],
});

const users = new UsersRepository({} as never, {} as never, {} as never);
const reports = new TorrentBlockerReportsRepository({} as never, {} as never, {} as never);

test('user ID filter binds an exact bigint without rounding or substring matching', () => {
    const result = users['applyUsersFilters'](db.selectFrom('users').selectAll(), [
        { id: 'id', value: '9007199254740993' },
    ]).compile();

    assert.match(result.sql, /where "users"\."id" = \$1$/);
    assert.deepEqual(result.parameters, [9007199254740993n]);
});

test('invalid user and Telegram IDs produce an empty-result predicate', () => {
    for (const id of ['id', 'telegramId']) {
        for (const value of ['invalid', '12.5', '1 OR 1=1']) {
            const result = users['applyUsersFilters'](db.selectFrom('users').selectAll(), [
                { id, value },
            ]).compile();

            assert.match(result.sql, /where false$/);
            assert.deepEqual(result.parameters, []);
        }
    }
});

test('valid Telegram ID search retains partial matching', () => {
    const result = users['applyUsersFilters'](db.selectFrom('users').selectAll(), [
        { id: 'telegramId', value: '123' },
    ]).compile();

    assert.match(result.sql, /like \$1$/);
    assert.deepEqual(result.parameters, ['%123%']);
});

test('report, user and node IDs use exact bigint parameters', () => {
    for (const [id, column] of [
        ['id', 'id'],
        ['userId', 'user_id'],
        ['nodeId', 'node_id'],
    ]) {
        const result = reports['applyFilters'](
            db.selectFrom('torrentBlockerReports').selectAll() as never,
            [{ id, value: '9007199254740993' }],
        ).compile();

        assert.ok(result.sql.endsWith(`where "torrent_blocker_reports"."${column}" = $1`));
        assert.deepEqual(result.parameters, [9007199254740993n]);
    }
});

test('invalid report IDs cannot remove or broaden the filter', () => {
    for (const id of ['id', 'userId', 'nodeId']) {
        for (const value of ['invalid', '12.5', '1 OR 1=1']) {
            const result = reports['applyFilters'](
                db.selectFrom('torrentBlockerReports').selectAll() as never,
                [{ id, value }],
            ).compile();

            assert.match(result.sql, /where false$/);
            assert.deepEqual(result.parameters, []);
        }
    }
});
