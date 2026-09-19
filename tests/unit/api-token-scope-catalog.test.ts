import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, Reflector } from '@nestjs/core';

import { SCOPE_RESOURCE } from '../../src/common/decorators/scopes';
import { ScopeCatalogService } from '../../src/modules/api-tokens/scope-catalog.service';

const SRC_DIR = join(__dirname, '..', '..', 'src');

function collectControllerFiles(dir: string): string[] {
    const files: string[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...collectControllerFiles(fullPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
            files.push(fullPath);
        }
    }

    return files.sort();
}

interface IScopeController {
    name: string;
    classRef: Function;
    source: string;
}

async function collectScopeControllers(): Promise<IScopeController[]> {
    const reflector = new Reflector();
    const controllers: IScopeController[] = [];

    for (const file of collectControllerFiles(SRC_DIR)) {
        const module: Record<string, unknown> = await import(pathToFileURL(file).href);

        for (const exported of Object.values(module)) {
            if (typeof exported !== 'function') {
                continue;
            }

            const resource = reflector.get<string | undefined>(SCOPE_RESOURCE, exported);
            if (!resource) {
                continue;
            }

            assert.notEqual(
                reflector.get<string | undefined>(PATH_METADATA, exported),
                undefined,
                `${exported.name} declares a scope resource without a route prefix (${relative(SRC_DIR, file)})`,
            );

            controllers.push({
                name: exported.name,
                classRef: exported,
                source: relative(SRC_DIR, file),
            });
        }
    }

    return controllers;
}

test('api token scope catalog bootstraps without duplicate endpoint slugs', async () => {
    const controllers = await collectScopeControllers();

    assert.ok(controllers.length > 0, 'expected at least one scope-decorated controller');

    const scopeCatalog = new ScopeCatalogService(
        {
            getControllers: () =>
                controllers.map((controller) => ({
                    instance: Object.create(controller.classRef.prototype) as object,
                    metatype: controller.classRef,
                })),
        } as never,
        new MetadataScanner(),
        new Reflector(),
    );

    // Throws on the custom-v0.2.2 build with:
    // Duplicate API token scope "system:configuration" - endpoint scope slugs must be unique within a resource
    scopeCatalog.onApplicationBootstrap();

    const catalog = scopeCatalog.getCatalog();

    assert.ok(catalog.length > 0, 'expected the scope catalog to contain endpoints');

    const owners = new Map<string, string[]>();

    for (const entry of catalog) {
        const owner = `${entry.resource} :: ${entry.method} ${entry.path}`;
        owners.set(entry.key, [...(owners.get(entry.key) ?? []), owner]);
    }

    const duplicates = [...owners.entries()].filter(([, list]) => list.length > 1);

    assert.deepEqual(
        duplicates,
        [],
        `duplicate API token endpoint scopes: ${JSON.stringify(
            duplicates.map(([key, list]) => `${key} <= ${list.join(', ')}`),
        )}`,
    );

    const systemScopes = catalog
        .filter((entry) => entry.resource === 'system')
        .map((entry) => entry.key);

    assert.equal(
        systemScopes.filter((scope) => scope === 'system:configuration').length,
        1,
        'system:configuration must stay assigned to exactly one endpoint (GET /api/system/configuration)',
    );

    assert.ok(
        systemScopes.includes('system:tls-certificate'),
        'panel TLS certificate metadata endpoint must expose its own unique system:tls-certificate scope',
    );
});
