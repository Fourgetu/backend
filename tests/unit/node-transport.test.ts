import 'reflect-metadata';
import { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import assert from 'node:assert/strict';
import https from 'node:https';
import { AddressInfo } from 'node:net';
import test, { TestContext } from 'node:test';
import { SocksProxyAgent } from 'socks-proxy-agent';

import { Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, CqrsModule } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';

import { INodeConnectionOpts } from '../../src/common/axios/axios.interfaces';
import { AxiosModule } from '../../src/common/axios/axios.module';
import { AxiosService } from '../../src/common/axios/axios.service';
import { GOST_NODE_API } from '../../src/common/axios/gost-forward.contract';
import { MtlsSocksProxyAgent } from '../../src/common/axios/mtls-agent';
import { ok } from '../../src/common/types';
import {
    generateMasterCerts,
    generateNodeCert,
} from '../../src/common/utils/certs/generate-certs.util';
import { GetNodeJwtCommand } from '../../src/modules/keygen/commands/get-node-jwt';
import { IGetNodeJwtResponse } from '../../src/modules/keygen/commands/get-node-jwt/get-node-jwt.command';
import { UserRoutesService } from '../../src/modules/user-routes/user-routes.service';

// These are deliberately non-PEM placeholders. No production credentials are fixtures.
const credentials: IGetNodeJwtResponse = {
    jwtToken: 'unit-test-only-jwt',
    clientCert: 'unit-test-only-client-certificate',
    clientKey: 'unit-test-only-client-private-key',
    caCert: 'unit-test-only-ca-certificate',
    jwtPublicKey: 'unit-test-only-jwt-public-key',
};
const node: INodeConnectionOpts = {
    address: 'node.invalid',
    port: 2222,
    proxyUrl: null,
    nodeUuid: 'unit-test-node',
};
const runtime = {
    applied: true,
    running: true,
    installed: true,
    gostVersion: '3.3.0',
    services: 0,
    configPath: '/unit-test/gost/config.json',
    error: null,
    portHopping: {
        mode: 'disabled' as const,
        available: false,
        applied: false,
        requiresNetAdmin: true as const,
        rules: 0,
        error: null,
    },
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function mockAdapter(service: AxiosService) {
    const requests: InternalAxiosRequestConfig[] = [];
    const instance = Reflect.get(service, 'axiosInstance') as AxiosInstance;
    instance.defaults.adapter = async (config) => {
        requests.push(config);
        return {
            config,
            status: 200,
            statusText: 'OK',
            headers: {},
            data: { response: runtime },
        };
    };
    return { instance, requests };
}

function createClient(
    t: TestContext,
    execute: () => Promise<unknown> = async () => ok(credentials),
) {
    let initializations = 0;
    const commandBus = {
        execute: async (command: unknown) => {
            assert.ok(command instanceof GetNodeJwtCommand);
            initializations += 1;
            return execute();
        },
    };
    const service = new AxiosService(commandBus as CommandBus);
    const logs: unknown[] = [];
    const logger = Reflect.get(service, 'logger') as Logger;
    t.mock.method(logger, 'log', () => undefined);
    t.mock.method(logger, 'error', (entry: unknown) => logs.push(entry));
    const adapter = mockAdapter(service);
    t.after(() => {
        for (const request of adapter.requests) {
            request.httpsAgent?.destroy();
        }
    });
    return {
        service,
        logs,
        ...adapter,
        get initializations() {
            return initializations;
        },
    };
}

function assertMtlsRequest(config: InternalAxiosRequestConfig, expected = credentials) {
    assert.ok(config.httpsAgent instanceof https.Agent);
    assert.equal(config.httpsAgent.options.rejectUnauthorized, true);
    assert.equal(config.httpsAgent.options.minVersion, 'TLSv1.3');
    assert.equal(config.httpsAgent.options.ca, expected.caCert);
    assert.equal(config.httpsAgent.options.cert, expected.clientCert);
    assert.equal(config.httpsAgent.options.key, expected.clientKey);
    assert.equal(config.headers.get('Authorization'), `Bearer ${expected.jwtToken}`);
}

test('API first GOST sync awaits transport initialization and uses the strict mTLS agent', async (t) => {
    const gate = deferred<ReturnType<typeof ok<IGetNodeJwtResponse>>>();
    const client = createClient(t, () => gate.promise);

    assert.equal(client.service.getNodeTransportInitializationStatus(), 'uninitialized');
    const request = client.service.syncGostForwards({ forwards: [] }, node);
    assert.equal(client.service.getNodeTransportInitializationStatus(), 'initializing');
    assert.equal(client.requests.length, 0);

    gate.resolve(ok(credentials));
    assert.equal((await request).isOk, true);
    assert.equal(client.initializations, 1);
    assert.equal(client.service.getNodeTransportInitializationStatus(), 'ready');
    assert.equal(client.requests[0].url, `https://node.invalid:2222${GOST_NODE_API.syncForwards}`);
    assert.equal(client.requests[0].method, 'post');
    assertMtlsRequest(client.requests[0]);
});

test('jobs and scheduler first Node control or health requests initialize their own client', async (t) => {
    const jobs = createClient(t);
    const scheduler = createClient(t);

    assert.equal((await jobs.service.stopXray(node)).isOk, true);
    assert.equal((await scheduler.service.getNodeHealth(node)).isOk, true);
    assert.equal(jobs.initializations, 1);
    assert.equal(scheduler.initializations, 1);
    assertMtlsRequest(jobs.requests[0]);
    assertMtlsRequest(scheduler.requests[0]);
    assert.notEqual(jobs.requests[0].httpsAgent, scheduler.requests[0].httpsAgent);
});

test('concurrent first requests and explicit initialization share one promise', async (t) => {
    const gate = deferred<ReturnType<typeof ok<IGetNodeJwtResponse>>>();
    const client = createClient(t, () => gate.promise);
    const initialization = client.service.ensureNodeTransportInitialized();
    assert.equal(client.service.ensureNodeTransportInitialized(), initialization);
    assert.equal(client.service.setJwt(), initialization);

    const first = client.service.getGostHealth(node);
    const second = client.service.syncGostForwards({ forwards: [] }, node);
    assert.equal(client.initializations, 1);
    assert.equal(client.requests.length, 0);
    gate.resolve(ok(credentials));

    const responses = await Promise.all([first, second]);
    assert.ok(responses.every((response) => response.isOk));
    assert.equal(client.requests.length, 2);
    assert.equal(client.requests[0].httpsAgent, client.requests[1].httpsAgent);
});

test('initialization failure blocks sending, logs safe context, and permits a later retry', async (t) => {
    const privateMarker = 'sensitive-test-marker-must-never-be-logged';
    let unavailable = true;
    const client = createClient(t, async () => {
        if (unavailable) throw new Error(privateMarker);
        return ok(credentials);
    });

    const result = await client.service.syncGostForwards({ forwards: [] }, node);
    assert.equal(result.isOk, false);
    assert.equal(client.requests.length, 0);
    assert.equal(client.service.getNodeTransportInitializationStatus(), 'failed');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateMarker));
    assert.doesNotMatch(JSON.stringify(client.logs), new RegExp(privateMarker));
    assert.deepEqual(client.logs, [
        {
            message: 'Node request failed',
            nodeUuid: node.nodeUuid,
            requestPath: GOST_NODE_API.syncForwards,
            errorCode: 'NODE_TRANSPORT_INIT_FAILED',
            tlsInitializationStatus: 'failed',
        },
    ]);

    unavailable = false;
    assert.equal((await client.service.getGostHealth(node)).isOk, true);
    assert.equal(client.initializations, 2);
    assert.equal(client.requests.length, 1);
    assertMtlsRequest(client.requests[0]);
});

test('a failed credential result or any missing credential fails closed', async (t) => {
    const rejected = createClient(t, async () => ({ isOk: false }));
    assert.equal((await rejected.service.getNodeHealth(node)).isOk, false);
    assert.equal(rejected.requests.length, 0);

    for (const field of Object.keys(credentials) as (keyof IGetNodeJwtResponse)[]) {
        const client = createClient(t, async () => ok({ ...credentials, [field]: ' ' }));
        assert.equal((await client.service.getNodeHealth(node)).isOk, false, field);
        assert.equal(client.requests.length, 0, field);
        assert.equal(client.service.getNodeTransportInitializationStatus(), 'failed');
    }
});

test('initialized requests reuse the same transport without reloading credentials', async (t) => {
    const client = createClient(t);

    await client.service.getNodeHealth(node);
    await client.service.syncGostForwards({ forwards: [] }, node);
    await client.service.getGostHealth(node);

    assert.equal(client.initializations, 1);
    assert.equal(client.requests.length, 3);
    for (const request of client.requests) {
        assert.equal(request.httpsAgent, client.requests[0].httpsAgent);
        assertMtlsRequest(request);
    }
});

test('SOCKS transport keeps strict CA verification even when connection options ask to disable it', async (t) => {
    let connectionOptions: Record<string, unknown> | undefined;
    t.mock.method(SocksProxyAgent.prototype, 'connect', async (_request, options) => {
        connectionOptions = options;
        return {} as never;
    });
    const agent = new MtlsSocksProxyAgent(
        'socks5://127.0.0.1:1080',
        { ca: credentials.caCert, cert: credentials.clientCert, key: credentials.clientKey },
        'unit-test-sni.invalid',
    );
    t.after(() => agent.destroy());
    await agent.connect(
        {} as never,
        {
            host: node.address,
            port: node.port,
            rejectUnauthorized: false,
        } as never,
    );
    assert.equal(connectionOptions?.rejectUnauthorized, true);
    assert.equal(connectionOptions?.minVersion, 'TLSv1.3');
    assert.equal(connectionOptions?.ca, credentials.caCert);
    assert.equal(connectionOptions?.cert, credentials.clientCert);
    assert.equal(connectionOptions?.key, credentials.clientKey);
    assert.equal(connectionOptions?.servername, 'unit-test-sni.invalid');
});

test('explicit refresh replaces direct and SOCKS transports and shares concurrent refreshes', async (t) => {
    let current = credentials;
    let refreshGate: ReturnType<
        typeof deferred<ReturnType<typeof ok<IGetNodeJwtResponse>>>
    > | null = null;
    const client = createClient(t, async () => refreshGate?.promise ?? ok(current));
    const proxyNode = { ...node, proxyUrl: 'socks5://127.0.0.1:1080' };
    await client.service.getNodeHealth(node);
    await client.service.getNodeHealth(proxyNode);
    await client.service.getNodeHealth(proxyNode);
    assert.ok(client.requests[1].httpsAgent instanceof MtlsSocksProxyAgent);
    assert.equal(client.requests[1].httpsAgent, client.requests[2].httpsAgent);

    current = { ...credentials, jwtToken: 'refreshed-test-jwt', clientKey: 'refreshed-test-key' };
    refreshGate = deferred();
    const refresh = client.service.setJwt();
    assert.equal(client.service.setJwt(), refresh);
    const whileRefreshing = client.service.getNodeHealth(node);
    assert.equal(client.requests.length, 3);
    refreshGate.resolve(ok(current));
    await Promise.all([refresh, whileRefreshing]);
    await client.service.getNodeHealth(proxyNode);

    assert.equal(client.initializations, 2);
    assert.notEqual(client.requests[0].httpsAgent, client.requests[3].httpsAgent);
    assert.notEqual(client.requests[1].httpsAgent, client.requests[4].httpsAgent);
    assertMtlsRequest(client.requests[3], current);
    assert.equal(client.requests[4].headers.get('Authorization'), `Bearer ${current.jwtToken}`);
    assert.deepEqual(Reflect.get(client.requests[4].httpsAgent, 'mtls'), {
        ca: current.caCert,
        cert: current.clientCert,
        key: current.clientKey,
    });
});

test('a failed explicit refresh cannot fall back to the previous transport', async (t) => {
    let current: unknown = ok(credentials);
    const client = createClient(t, async () => current);
    await client.service.getNodeHealth(node);
    current = { isOk: false };

    await assert.rejects(client.service.setJwt(), /Node mTLS transport initialization failed/);
    assert.equal((await client.service.getNodeHealth(node)).isOk, false);
    assert.equal(client.requests.length, 1);
    assert.equal(client.service.getNodeTransportInitializationStatus(), 'failed');
});

test('a same-tick refresh cannot invalidate a request that already acquired a ready transport', async (t) => {
    let current = credentials;
    let refreshGate: ReturnType<
        typeof deferred<ReturnType<typeof ok<IGetNodeJwtResponse>>>
    > | null = null;
    const client = createClient(t, async () => refreshGate?.promise ?? ok(current));
    await client.service.ensureNodeTransportInitialized();

    const readyRequest = client.service.getGostHealth(node);
    current = { ...credentials, jwtToken: 'refreshed-test-jwt', clientKey: 'refreshed-test-key' };
    refreshGate = deferred();
    const refresh = client.service.setJwt();
    assert.equal((await readyRequest).isOk, true);
    assertMtlsRequest(client.requests[0], credentials);
    assert.equal(client.service.getNodeTransportInitializationStatus(), 'initializing');

    const newRequest = client.service.getGostHealth(node);
    assert.equal(client.requests.length, 1);
    refreshGate.resolve(ok(current));
    await refresh;
    assert.equal((await newRequest).isOk, true);
    assertMtlsRequest(client.requests[1], current);
    assert.notEqual(client.requests[0].httpsAgent, client.requests[1].httpsAgent);
});

test('refresh during compression cannot mix an old HTTPS agent with a refreshed JWT', async (t) => {
    let current = credentials;
    const client = createClient(t, async () => ok(current));
    const compressionStarted = deferred<void>();
    const compressionResult = deferred<{ buffer: Buffer; size: number }>();
    t.mock.method(client.service as never, 'compressData', async () => {
        compressionStarted.resolve();
        return compressionResult.promise;
    });

    const request = client.service.addUsers({ users: [] } as never, node);
    await compressionStarted.promise;
    current = { ...credentials, jwtToken: 'refreshed-test-jwt', clientKey: 'refreshed-test-key' };
    await client.service.setJwt();
    compressionResult.resolve({ buffer: Buffer.from('compressed-fixture'), size: 2 });
    assert.equal((await request).isOk, true);
    assertMtlsRequest(client.requests[0], credentials);
    assert.equal(client.requests[0].headers.get('Content-Encoding'), 'zstd');

    await client.service.getNodeHealth(node);
    assertMtlsRequest(client.requests[1], current);
});

test('GOST TLS errors keep node/path/code context without logging credentials or raw Axios config', async (t) => {
    const client = createClient(t);
    client.instance.defaults.adapter = async (config) => {
        throw new AxiosError(
            'self-signed certificate in certificate chain',
            'SELF_SIGNED_CERT_IN_CHAIN',
            config,
        );
    };
    assert.equal((await client.service.syncGostForwards({ forwards: [] }, node)).isOk, false);
    assert.deepEqual(client.logs, [
        {
            message: 'Node request failed',
            nodeUuid: node.nodeUuid,
            requestPath: GOST_NODE_API.syncForwards,
            errorCode: 'SELF_SIGNED_CERT_IN_CHAIN',
            tlsInitializationStatus: 'ready',
        },
    ]);
    for (const value of Object.values(credentials)) {
        assert.equal(JSON.stringify(client.logs).includes(value), false);
    }
});

test(
    'Nest API bootstrap registers the real CQRS handler before startup GOST reconciliation',
    { timeout: 5000 },
    async () => {
        let initializations = 0;
        let writes = 0;
        const gate = deferred<ReturnType<typeof ok<IGetNodeJwtResponse>>>();
        const credentialRequested = deferred<void>();

        @CommandHandler(GetNodeJwtCommand)
        class TestNodeCredentialsHandler {
            async execute() {
                initializations += 1;
                credentialRequested.resolve();
                return gate.promise;
            }
        }

        // tsx does not emit constructor metadata; mirror the production compiler's metadata.
        Reflect.defineMetadata('design:paramtypes', [CommandBus], AxiosService);
        const prisma = {
            userRoutes: {
                findMany: async (query: { distinct?: string[] }) =>
                    query.distinct ? [{ nodeUuid: node.nodeUuid }] : [],
                update: async () => {
                    writes += 1;
                },
            },
        };
        const repository = { findRuntimeByNodeUuid: async () => [] };
        const nodesRepository = {
            findByUUID: async () => ({ ...node, uuid: node.nodeUuid }),
        };
        const allocator = { restoreDesiredState: async () => ({ issues: [] }) };
        const app = await Test.createTestingModule({
            imports: [CqrsModule, AxiosModule],
            providers: [
                TestNodeCredentialsHandler,
                {
                    provide: UserRoutesService,
                    inject: [AxiosService],
                    useFactory: (client: AxiosService) =>
                        new UserRoutesService(
                            prisma as never,
                            repository as never,
                            client,
                            nodesRepository as never,
                            allocator as never,
                        ),
                },
            ],
        }).compile();
        const client = app.get(AxiosService);
        const { requests } = mockAdapter(client);
        try {
            const initializing = app.init();
            await credentialRequested.promise;
            assert.equal(client.getNodeTransportInitializationStatus(), 'initializing');
            assert.equal(requests.length, 0);
            gate.resolve(ok(credentials));
            await initializing;

            assert.ok(app.get(UserRoutesService));
            assert.equal(initializations, 1);
            assert.equal(writes, 0);
            assert.equal(requests.length, 1);
            assert.equal(requests[0].url, `https://node.invalid:2222${GOST_NODE_API.syncForwards}`);
            assertMtlsRequest(requests[0]);
        } finally {
            gate.resolve(ok(credentials));
            for (const request of requests) request.httpsAgent?.destroy();
            await app.close();
        }
    },
);

test(
    'real loopback TLS accepts the managed CA/client pair and rejects an unrelated CA',
    { timeout: 5000 },
    async (t) => {
        // All certificates/keys are ephemeral, generated in memory, and never written or logged.
        const master = await generateMasterCerts();
        const serverCredentials = await generateNodeCert(master.caCertPem, master.caKeyPem);
        const unrelatedMaster = await generateMasterCerts();
        let received = 0;
        let authenticated = false;
        const server = https.createServer(
            {
                key: serverCredentials.nodeKeyPem,
                cert: serverCredentials.nodeCertPem,
                ca: master.caCertPem,
                requestCert: true,
                rejectUnauthorized: true,
                minVersion: 'TLSv1.3',
            },
            (request, response) => {
                received += 1;
                authenticated = Boolean(Reflect.get(request.socket, 'authorized'));
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify({ response: runtime }));
            },
        );
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        t.after(async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        });
        const transportCredentials = {
            ...credentials,
            caCert: master.caCertPem,
            clientCert: master.clientCertPem,
            clientKey: master.clientKeyPem,
        };
        const trusted = createClient(t, async () => ok(transportCredentials));
        const untrusted = createClient(t, async () =>
            ok({ ...transportCredentials, caCert: unrelatedMaster.caCertPem }),
        );
        for (const client of [trusted, untrusted]) {
            // Use Axios's real HTTP adapter; no external proxy/network or remote server is involved.
            client.instance.defaults.adapter = 'http';
            client.instance.defaults.proxy = false;
        }
        const localNode = {
            ...node,
            address: '127.0.0.1',
            port: (server.address() as AddressInfo).port,
        };
        assert.equal((await trusted.service.getGostHealth(localNode)).isOk, true);
        assert.equal(received, 1);
        assert.equal(authenticated, true);
        assert.equal((await untrusted.service.getGostHealth(localNode)).isOk, false);
        assert.equal(received, 1, 'an untrusted server must never reach the HTTP handler');
        for (const client of [trusted, untrusted]) {
            const transport = await client.service.ensureNodeTransportInitialized();
            transport.httpsAgent.destroy();
            assert.equal(transport.httpsAgent.options.rejectUnauthorized, true);
        }
    },
);
