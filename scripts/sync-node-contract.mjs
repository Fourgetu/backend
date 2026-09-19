import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceDir = path.resolve(
    root,
    process.env.NODE_CONTRACT_SOURCE_DIR ?? '../node/libs/contract',
);
const targetDir = path.resolve(root, 'libs/node-contract');
const sourceRepository = 'Fourgetu/node';
const sourcePath = 'libs/contract';

const collectFiles = async (directory, relative = '') => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const entryRelative = path.join(relative, entry.name);
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === 'build' || entry.name === 'dist' || entry.name === 'node_modules') continue;
            files.push(...(await collectFiles(entryPath, entryRelative)));
        } else if (entry.isFile()) {
            files.push(entryRelative);
        }
    }

    return files;
};

const hashDirectory = async (directory) => {
    const hash = createHash('sha256');
    const files = (await collectFiles(directory)).sort((a, b) => a.localeCompare(b));

    for (const relative of files) {
        hash.update(relative.replaceAll(path.sep, '/'));
        hash.update('\0');
        hash.update((await readFile(path.join(directory, relative), 'utf8')).replaceAll('\r\n', '\n'));
        hash.update('\0');
    }

    return hash.digest('hex');
};

const commit =
    process.env.NODE_CONTRACT_SOURCE_COMMIT ??
    execFileSync('git', ['-C', path.resolve(sourceDir, '..', '..'), 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
    }).trim();
const sourcePackage = JSON.parse(await readFile(path.join(sourceDir, 'package.json'), 'utf8'));

await rm(targetDir, { recursive: true, force: true });
await mkdir(path.dirname(targetDir), { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });

const metadata = {
    repository: sourceRepository,
    sourcePath,
    commit,
    version: sourcePackage.version,
    sha256: await hashDirectory(targetDir),
};

await writeFile(
    path.join(root, 'NODE_CONTRACT_SOURCE.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
);

console.log(`Synchronized ${sourceRepository}@${commit} to ${targetDir}`);
