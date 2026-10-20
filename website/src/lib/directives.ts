const REGION_START = /^\s*\/\/\s*#region\s+(\S+)\s*$/;
const REGION_END = /^\s*\/\/\s*#endregion\b/;

/** The lines between `// #region <name>` and its matching `// #endregion`, markers stripped and dedented. */
export function extractRegion(source: string, name: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => REGION_START.exec(line)?.[1] === name);
  if (start === -1) throw new Error(`region "${name}" not found`);
  const body: string[] = [];
  let depth = 1;
  for (const line of lines.slice(start + 1)) {
    if (REGION_START.test(line)) {
      depth += 1;
    } else if (REGION_END.test(line)) {
      depth -= 1;
      if (depth === 0) return dedent(body);
    } else {
      body.push(line);
    }
  }
  throw new Error(`region "${name}" is not closed`);
}

function dedent(lines: string[]): string {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length);
  const cut = Math.min(...indents);
  return lines.map((line) => line.slice(cut)).join('\n');
}
