import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const contractDir = path.resolve(root, 'libs/node-contract');
const metadataPath = path.resolve(root, 'NODE_CONTRACT_SOURCE.json');

const parseArgs = () => {
    const args = process.argv.slice(2);
    const sourceFlag = args.indexOf('--source-dir');
    return {
        sourceDir: sourceFlag >= 0 ? args[sourceFlag + 1] : process.env.NODE_CONTRACT_SOURCE_DIR,
    };
};

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

const fail = (message) => {
    console.error(`Node Contract sync check failed: ${message}`);
    process.exit(1);
};

const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const localPackage = JSON.parse(await readFile(path.join(contractDir, 'package.json'), 'utf8'));
const localHash = await hashDirectory(contractDir);

if (metadata.repository !== 'Fourgetu/node') fail(`unexpected repository ${metadata.repository}`);
if (metadata.sourcePath !== 'libs/contract') fail(`unexpected sourcePath ${metadata.sourcePath}`);
if (metadata.version !== '3.4.2') fail(`unexpected contract version ${metadata.version}`);
if (localPackage.version !== metadata.version) {
    fail(`vendored package version ${localPackage.version} does not match ${metadata.version}`);
}
if (localHash !== metadata.sha256) {
    fail(`vendored hash ${localHash} does not match metadata ${metadata.sha256}`);
}

const { sourceDir } = parseArgs();
if (sourceDir) {
    const sourceHash = await hashDirectory(path.resolve(root, sourceDir));
    if (sourceHash !== localHash) {
        fail(`vendored hash ${localHash} does not match canonical source hash ${sourceHash}`);
    }
}

console.log(
    `Node Contract ${metadata.version} verified: ${metadata.repository}@${metadata.commit} (${localHash})`,
);
