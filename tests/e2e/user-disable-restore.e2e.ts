/* eslint-disable no-console */
import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HashedSet } from '@remnawave/hashed-set';

import { SingBoxConfig } from '../../src/common/helpers/core-config/singbox-config.validator';
import { XRayConfig } from '../../src/common/helpers/xray-config/xray-config.validator';
import { AddUserToNodeEvent } from '../../src/modules/nodes/events/add-user-to-node';
import { AddUserToNodeHandler } from '../../src/modules/nodes/events/add-user-to-node/add-user-to-node.handler';
import { RemoveUserFromNodeEvent } from '../../src/modules/nodes/events/remove-user-from-node';
import { RemoveUserFromNodeHandler } from '../../src/modules/nodes/events/remove-user-from-node/remove-user-from-node.handler';

const image = process.env.DUAL_CORE_IMAGE || 'remnawave-node-dualcore:amd64-hopping-test';
const suffix = process.pid;
const names = {
    network: `remnawave-user-event-${suffix}`,
    runtime: `remnawave-user-event-runtime-${suffix}`,
    target: `remnawave-user-event-target-${suffix}`,
};
let temporaryDirectory = '';
const user = {
    id: 101n,
    vlessUuid: '5a8b1b7a-4983-4e83-b96a-e6cd1f206214',
    trojanPassword: 'trojan-password',
    ssPassword: 'shadowsocks-password',
    socksUsername: 'rw-user-101',
    socksPassword: 'socks-password-101',
    tags: ['xray-socks', 'singbox-socks'],
};
let userEnabled = true;
let startNodeCalls = 0;

const docker = (args: string[], options: { allowFailure?: boolean; capture?: boolean } = {}) => {
    const result = spawnSync('docker', args, {
        encoding: 'utf8',
        stdio: options.capture ? 'pipe' : 'inherit',
        timeout: 60_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && !options.allowFailure) {
        throw new Error(
            `docker ${args.join(' ')} failed with exit code ${result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`,
        );
    }
    return result;
};

const waitForPort = async (port: number) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const socket = createConnection({ host: '127.0.0.1', port });
        const outcome = await Promise.race([
            once(socket, 'connect').then(() => true),
            once(socket, 'error').then(() => false),
            new Promise<boolean>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 250)),
        ]);
        socket.destroy();
        if (outcome) return;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    throw new Error(`Timed out waiting for TCP port ${port}`);
};

class SocketReader {
    private buffer = Buffer.alloc(0);
    private readonly pending: Array<{
        length: number;
        reject: (error: Error) => void;
        resolve: (value: Buffer) => void;
    }> = [];

    constructor(private readonly socket: Socket) {
        socket.on('data', (chunk) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            this.flush();
        });
        socket.on('error', (error) => this.fail(error));
        socket.on('end', () => this.fail(new Error('SOCKS connection ended')));
    }

    public read(length: number): Promise<Buffer> {
        if (this.buffer.length >= length) return Promise.resolve(this.take(length));
        return new Promise((resolveRead, rejectRead) => {
            this.pending.push({ length, resolve: resolveRead, reject: rejectRead });
        });
    }

    private flush() {
        while (this.pending.length > 0 && this.buffer.length >= this.pending[0].length) {
            const request = this.pending.shift()!;
            request.resolve(this.take(request.length));
        }
    }

    private fail(error: Error) {
        for (const request of this.pending.splice(0)) request.reject(error);
    }

    private take(length: number) {
        const value = this.buffer.subarray(0, length);
        this.buffer = this.buffer.subarray(length);
        return value;
    }
}

const encodeAuth = () => {
    const username = Buffer.from(user.socksUsername);
    const password = Buffer.from(user.socksPassword);
    return Buffer.concat([
        Buffer.from([1, username.length]),
        username,
        Buffer.from([password.length]),
        password,
    ]);
};

const openAuthenticatedTunnel = async (port: number) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    await once(socket, 'connect');
    socket.setTimeout(8_000, () => socket.destroy(new Error('SOCKS test timed out')));
    const reader = new SocketReader(socket);
    socket.write(Buffer.from([5, 1, 2]));
    const greeting = await reader.read(2);
    if (!greeting.equals(Buffer.from([5, 2]))) {
        throw new Error(`SOCKS server on ${port} did not require password authentication`);
    }
    socket.write(encodeAuth());
    const auth = await reader.read(2);
    if (!auth.equals(Buffer.from([1, 0]))) {
        throw new Error(`SOCKS server on ${port} rejected the active credential`);
    }
    const host = Buffer.from('http-target');
    socket.write(
        Buffer.concat([
            Buffer.from([5, 1, 0, 3, host.length]),
            host,
            Buffer.from([18080 >> 8, 18080 & 0xff]),
        ]),
    );
    const reply = await reader.read(4);
    if (reply[0] !== 5 || reply[1] !== 0) throw new Error(`SOCKS CONNECT failed on ${port}`);
    const addressLength = reply[3] === 1 ? 4 : reply[3] === 4 ? 16 : (await reader.read(1))[0];
    await reader.read(addressLength + 2);
    socket.write('GET / HTTP/1.1\r\nHost: http-target\r\nConnection: close\r\n\r\n');
    let response = '';
    while (!response.includes('\r\n')) response += (await reader.read(1)).toString();
    socket.destroy();
    if (!response.startsWith('HTTP/1.1 200')) throw new Error(`Unexpected response: ${response}`);
};

const expectCredentialUnavailable = async (port: number) => {
    try {
        await openAuthenticatedTunnel(port);
    } catch {
        return;
    }
    throw new Error(`Disabled credential still connected through ${port}`);
};

const buildRuntimeConfigs = async () => {
    const hashes = new Map<string, HashedSet>();
    const users = userEnabled ? [user] : [];
    const xray = new XRayConfig({
        log: { loglevel: 'warning' },
        inbounds: [
            {
                tag: 'xray-socks',
                listen: '127.0.0.1',
                port: 1080,
                protocol: 'socks',
                settings: { auth: 'password', accounts: [], udp: true },
            },
        ],
        outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    });
    xray.cleanInboundClients(true);
    xray.includeUserBatch(users, hashes);
    xray.finalizeInboundClients();

    const singbox = new SingBoxConfig({
        log: { level: 'warn' },
        inbounds: [
            {
                type: 'socks',
                tag: 'singbox-socks',
                listen: '127.0.0.1',
                listen_port: 1081,
                users: [],
            },
        ],
        outbounds: [{ type: 'direct', tag: 'direct' }],
        route: { final: 'direct' },
    });
    singbox.cleanInboundClients();
    singbox.includeUserBatch(users, hashes);
    singbox.finalizeInboundClients();

    const gost = {
        services: [
            {
                name: 'xray-user-route',
                addr: '0.0.0.0:32101',
                handler: { type: 'tcp' },
                listener: { type: 'tcp' },
                forwarder: { nodes: [{ name: 'xray', addr: '127.0.0.1:1080' }] },
            },
            {
                name: 'singbox-user-route',
                addr: '0.0.0.0:32102',
                handler: { type: 'tcp' },
                listener: { type: 'tcp' },
                forwarder: { nodes: [{ name: 'singbox', addr: '127.0.0.1:1081' }] },
            },
        ],
    };
    await Promise.all([
        writeFile(join(temporaryDirectory, 'xray.json'), JSON.stringify(xray.getConfig(), null, 2)),
        writeFile(
            join(temporaryDirectory, 'singbox.json'),
            JSON.stringify(singbox.getConfig(), null, 2),
        ),
        writeFile(join(temporaryDirectory, 'gost.json'), JSON.stringify(gost, null, 2)),
    ]);
};

const restartRuntime = async () => {
    startNodeCalls += 1;
    await buildRuntimeConfigs();
    docker(['restart', '--timeout', '2', names.runtime]);
    await Promise.all([waitForPort(32101), waitForPort(32102)]);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
};

const node = {
    uuid: 'node-1',
    address: '127.0.0.1',
    port: 2222,
    proxyUrl: null,
    activeConfigProfileUuid: 'xray-profile',
    activeSingBoxConfigProfileUuid: 'singbox-profile',
    activeInbounds: [
        { tag: 'xray-socks', type: 'socks' },
        { tag: 'singbox-socks', type: 'socks' },
    ],
};
const nodesRepository = { findConnectedNodes: async () => [node] };
const nodesQueuesService = {
    startNode: async () => restartRuntime(),
    removeUserFromNodeBulk: async (items: unknown[]) => {
        if (items.length > 0) {
            throw new Error('SOCKS credential changes must use one full dual-core rebuild');
        }
    },
    addUserToNode: async () => {
        throw new Error('SOCKS credential changes must use one full dual-core rebuild');
    },
    removeUserFromNode: async () => {
        throw new Error('SOCKS credential changes must use one full dual-core rebuild');
    },
};
const queryBus = {
    execute: async () => ({
        isOk: true,
        response: {
            ...user,
            inbounds: [
                { tag: 'xray-socks', type: 'socks', rawInbound: {} },
                { tag: 'singbox-socks', type: 'socks', rawInbound: {} },
            ],
        },
    }),
};

const main = async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'remnawave-user-event-'));
    try {
        await buildRuntimeConfigs();
        docker(['image', 'inspect', image], { capture: true });
        docker(['network', 'create', names.network]);
        docker([
            'run',
            '--rm',
            '-d',
            '--network',
            names.network,
            '--network-alias',
            'http-target',
            '--name',
            names.target,
            '--entrypoint',
            'node',
            image,
            '-e',
            "require('node:http').createServer((q,s)=>s.end('ok')).listen(18080,'0.0.0.0')",
        ]);
        docker([
            'run',
            '--rm',
            '-d',
            '--network',
            names.network,
            '--name',
            names.runtime,
            '--entrypoint',
            '/bin/sh',
            '-p',
            '127.0.0.1:32101:32101',
            '-p',
            '127.0.0.1:32102:32102',
            '-v',
            `${temporaryDirectory}:/test:ro`,
            image,
            '-c',
            '/usr/local/bin/xray run -config /test/xray.json >/tmp/xray.log 2>&1 & ' +
                '/usr/local/bin/sing-box run -c /test/singbox.json >/tmp/singbox.log 2>&1 & ' +
                'exec /usr/local/bin/gost -C /test/gost.json >/tmp/gost.log 2>&1',
        ]);
        await Promise.all([waitForPort(32101), waitForPort(32102)]);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
        await Promise.all([openAuthenticatedTunnel(32101), openAuthenticatedTunnel(32102)]);

        const removeHandler = new RemoveUserFromNodeHandler(
            nodesRepository as never,
            nodesQueuesService as never,
        );
        userEnabled = false;
        await removeHandler.handle(new RemoveUserFromNodeEvent(user.id, user.vlessUuid));
        await Promise.all([expectCredentialUnavailable(32101), expectCredentialUnavailable(32102)]);

        const addHandler = new AddUserToNodeHandler(
            nodesRepository as never,
            nodesQueuesService as never,
            queryBus as never,
        );
        userEnabled = true;
        await addHandler.handle(new AddUserToNodeEvent(user.id));
        await Promise.all([openAuthenticatedTunnel(32101), openAuthenticatedTunnel(32102)]);

        if (startNodeCalls !== 2) {
            throw new Error(
                `Expected exactly one dual-core rebuild per event, received ${startNodeCalls}`,
            );
        }
        console.log(
            'PASS: Backend remove-user event invalidated the credential in both real runtimes.',
        );
        console.log(
            'PASS: Backend add-user event restored new authenticated connections in both runtimes.',
        );
        console.log(
            'PASS: each event triggered exactly one dual-core rebuild without a reload loop.',
        );
    } catch (error) {
        const logs = docker(['logs', names.runtime], { allowFailure: true, capture: true });
        if (logs.stdout || logs.stderr) console.error(logs.stdout, logs.stderr);
        const runtimeLogs = docker(
            [
                'exec',
                names.runtime,
                'sh',
                '-c',
                'for f in /tmp/xray.log /tmp/singbox.log /tmp/gost.log; do echo "--- $f"; cat "$f" 2>/dev/null; done',
            ],
            { allowFailure: true, capture: true },
        );
        if (runtimeLogs.stdout || runtimeLogs.stderr) {
            console.error(runtimeLogs.stdout, runtimeLogs.stderr);
        }
        throw error;
    } finally {
        docker(['rm', '-f', names.runtime, names.target], { allowFailure: true, capture: true });
        docker(['network', 'rm', names.network], { allowFailure: true, capture: true });
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
};

void main();
