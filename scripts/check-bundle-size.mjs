import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({
  options: {
    json: { type: 'boolean', default: false },
    limits: { type: 'string', default: join(root, 'scripts/bundle-limits.json') },
    fixtures: { type: 'string', default: join(root, 'scripts/bundle-fixtures') },
  },
});
const limits = JSON.parse(await readFile(values.limits, 'utf8'));
const measured = {};
const errors = [];

for (const [name, { gzip, forbidden }] of Object.entries(limits)) {
  const outfile = join(values.fixtures, `${name}.out.js`);
  const result = await build({
    entryPoints: [join(values.fixtures, `${name}.ts`)],
    outfile,
    write: false,
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    metafile: true,
    logLevel: 'silent',
    absWorkingDir: root,
    alias: { '@fieldnotes/core': join(root, 'packages/core/src/index.ts') },
  });
  const size = gzipSync(result.outputFiles[0].contents, { level: 9 }).length;
  measured[name] = size;
  if (size > gzip) errors.push(`Bundle budget: ${name} is ${size} bytes gzipped, limit ${gzip}.`);
  // metafile.inputs lists every reachable module; only output inputs reflect what survived tree-shaking.
  const output = result.metafile.outputs[relative(root, outfile)];
  for (const [path, { bytesInOutput }] of Object.entries(output.inputs)) {
    if (bytesInOutput > 0 && forbidden.some((part) => path.includes(part))) {
      errors.push(`Bundle budget: ${name} contains forbidden module ${path}.`);
    }
  }
}

console.log(
  values.json
    ? JSON.stringify(measured)
    : Object.entries(measured)
        .map(([name, size]) => `${name}: ${size} bytes gzipped`)
        .join('\n'),
);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
