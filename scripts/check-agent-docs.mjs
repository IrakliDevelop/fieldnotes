import { readFile, readdir, readlink } from 'node:fs/promises';
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
  '.agents/skills/THIRD_PARTY.md',
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

const skillsRoot = '.agents/skills';
const skillNames = [];
for (const entry of await readdir(resolve(root, skillsRoot), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = `${skillsRoot}/${entry.name}/SKILL.md`;
  let content;
  try {
    content = await readFile(resolve(root, path), 'utf8');
  } catch {
    continue;
  }
  skillNames.push(entry.name);
  contents.set(path, content);

  const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const field = (key) =>
    frontmatter.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() ?? '';
  const name = field('name');
  const description = field('description');
  if (name !== entry.name) {
    errors.push(`Skill name mismatch in ${path}: ${name || 'missing'}`);
  }
  if (!description) {
    errors.push(`Skill description missing in ${path}`);
  } else if (!/^['"]/.test(description) && description.includes(': ')) {
    errors.push(`Unquoted ": " in skill description (invalid YAML): ${path}`);
  }

  const link = `.claude/skills/${entry.name}`;
  const expected = `../../${skillsRoot}/${entry.name}`;
  try {
    const target = await readlink(resolve(root, link));
    if (target !== expected) {
      errors.push(`Claude Code skill link must be ${expected}: ${link} -> ${target}`);
    }
  } catch {
    errors.push(`Missing Claude Code skill link: ${link}`);
  }
}

const requiredSkills = [
  'fieldnotes-development',
  'fieldnotes-concise-code',
  'fieldnotes-typescript',
  'fieldnotes-testing',
  'fieldnotes-visual-tests',
  'fieldnotes-pointer-input',
  'fieldnotes-sync-security',
  'fieldnotes-browser-check',
];
for (const skill of requiredSkills) {
  if (!skillNames.includes(skill)) errors.push(`Missing required skill: ${skill}`);
}
const router = contents.get('.agents/skills/fieldnotes-development/SKILL.md') ?? '';
for (const skill of requiredSkills.slice(1)) {
  if (!router.includes(`\`${skill}\``)) errors.push(`Router skill does not list: ${skill}`);
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
  let manifestSource;
  try {
    manifestSource = await readFile(resolve(root, 'packages', entry.name, 'package.json'), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
  const manifest = JSON.parse(manifestSource);
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

const adviserPath = '.claude/agents/fn-decision-advisor.md';
let adviser = '';
try {
  adviser = await readFile(resolve(root, adviserPath), 'utf8');
} catch {
  errors.push(`Missing decision adviser definition: ${adviserPath}`);
}
if (adviser) {
  const frontmatter = adviser.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  if (!/^name: fn-decision-advisor$/m.test(frontmatter)) {
    errors.push('Claude decision adviser name must be fn-decision-advisor');
  }
  if (!/^model: claude-fable-5-1$/m.test(frontmatter)) {
    errors.push('Claude decision adviser model must be claude-fable-5-1');
  }
  if (!/^tools: \[Read, Grep, Glob\]$/m.test(frontmatter)) {
    errors.push('Claude decision adviser tools must be [Read, Grep, Glob]');
  }
}

const codexAdviserPath = '.codex/agents/fn-decision-advisor.toml';
let codexAdviser = '';
try {
  codexAdviser = await readFile(resolve(root, codexAdviserPath), 'utf8');
} catch {
  errors.push(`Missing decision adviser definition: ${codexAdviserPath}`);
}
if (codexAdviser) {
  if (!/^name = "fn_decision_advisor"$/m.test(codexAdviser)) {
    errors.push('Codex decision adviser name must be fn_decision_advisor');
  }
  if (!/^model = "gpt-6-astra"$/m.test(codexAdviser)) {
    errors.push('Codex decision adviser model must be gpt-6-astra');
  }
  if (!/^model_reasoning_effort = "ultra"$/m.test(codexAdviser)) {
    errors.push('Codex decision adviser reasoning must be ultra');
  }
  if (!/^sandbox_mode = "read-only"$/m.test(codexAdviser)) {
    errors.push('Codex decision adviser sandbox must be read-only');
  }
}

let codexConfig = '';
try {
  codexConfig = await readFile(resolve(root, '.codex/config.toml'), 'utf8');
} catch {
  errors.push('Missing Codex configuration: .codex/config.toml');
}
if (!/^\[agents\.fn_decision_advisor\]$/m.test(codexConfig)) {
  errors.push('Codex configuration must register fn_decision_advisor');
}
if (!/^config_file = "agents\/fn-decision-advisor\.toml"$/m.test(codexConfig)) {
  errors.push('Codex configuration must reference agents/fn-decision-advisor.toml');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Agent tooling OK: ${required.length} files, ${skillNames.length} skills, ${packageNames.length} packages.`,
  );
}
