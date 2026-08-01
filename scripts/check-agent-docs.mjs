import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const required = [
  'AGENTS.md',
  'docs/agents/README.md',
  'docs/agents/architecture.md',
  'docs/agents/workflow.md',
  'docs/agents/review.md',
  '.agents/skills/fieldnotes-development/SKILL.md',
];
const errors = [];
const contents = new Map();

for (const path of required) {
  try {
    contents.set(path, await readFile(resolve(root, path), 'utf8'));
  } catch {
    errors.push(`Missing required agent file: ${path}`);
  }
}

const markdownLink = /\[[^\]]+\]\((?!https?:|#)([^)]+\.md)(?:#[^)]+)?\)/g;
for (const [source, content] of contents) {
  for (const match of content.matchAll(markdownLink)) {
    try {
      await readFile(resolve(root, dirname(source), match[1]), 'utf8');
    } catch {
      errors.push(`Broken Markdown link in ${source}: ${match[1]}`);
    }
  }
}

const packageNames = [];
for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(
    await readFile(resolve(root, 'packages', entry.name, 'package.json'), 'utf8'),
  );
  packageNames.push(manifest.name);
}

const architecture = contents.get('docs/agents/architecture.md') ?? '';
for (const packageName of packageNames) {
  if (!architecture.includes(packageName)) {
    errors.push(`Architecture map does not mention workspace package: ${packageName}`);
  }
}

const coreManifest = JSON.parse(
  await readFile(resolve(root, 'packages/core/package.json'), 'utf8'),
);
const coreIndex = await readFile(resolve(root, 'packages/core/src/index.ts'), 'utf8');
const version = coreIndex.match(/VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (version !== coreManifest.version) {
  errors.push(
    `Core VERSION mismatch: package=${coreManifest.version}, source=${version ?? 'missing'}`,
  );
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Agent tooling OK: ${required.length} files, ${packageNames.length} packages.`);
}
