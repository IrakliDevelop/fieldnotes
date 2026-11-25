import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const limits = JSON.parse(await readFile(resolve(root, 'scripts/size-limits.json'), 'utf8'));
const errors = [];

for (const [path, limit] of Object.entries(limits)) {
  let content;
  try {
    content = await readFile(resolve(root, path), 'utf8');
  } catch {
    errors.push(`Size ratchet: ${path} is listed in scripts/size-limits.json but does not exist`);
    continue;
  }
  // Newline count matches `wc -l`.
  const lines = content.split('\n').length - 1;
  if (lines > limit) {
    errors.push(
      `Size ratchet: ${path} has ${lines} lines, limit ${limit}. Move behaviour into a collaborator; see docs/agents/architecture.md.`,
    );
  } else if (limit - lines > 25) {
    console.log(
      `Size ratchet: ${path} has ${lines} lines, limit ${limit}. Lower the limit in scripts/size-limits.json.`,
    );
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
