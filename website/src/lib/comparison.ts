const COLUMNS = ['Field Notes', 'tldraw', 'Excalidraw'] as const;
/** The other projects' columns, in table order. */
export const OTHER_COLUMNS = ['tldraw', 'Excalidraw'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GLYPHS = /[✓✔✕✗✘]/;
const REPOSITORY = 'https://github.com/IrakliDevelop/fieldnotes';
const BUNDLEPHOBIA = 'https://bundlephobia.com/package/@fieldnotes/core';

/** A claim about another project, with where and when it was checked. */
export interface SourcedCell {
  text: string;
  source: string;
  checkedOn: string;
}

/** One compared capability; an absent cell is a claim nobody could source. */
export interface ComparisonRow {
  id: string;
  label: string;
  home: boolean;
  cells: {
    'Field Notes': { text: string; href: string };
    tldraw?: SourcedCell;
    Excalidraw?: SourcedCell;
  };
}

/** The landing page comparison table. */
export interface Comparison {
  checkedOn: string;
  columns: typeof COLUMNS;
  rows: ComparisonRow[];
}

/** Whether a Field Notes href leaves the site, so it skips the base path. */
export const isExternal = (href: string): boolean => href.startsWith('https://');

function fail(message: string): never {
  throw new Error(`comparison.json: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cellText(cell: Record<string, unknown>, where: string): string {
  if (typeof cell.text !== 'string' || cell.text === '') fail(`${where}: text is required`);
  if (GLYPHS.test(cell.text)) fail(`${where}: no check or cross glyphs`);
  return cell.text;
}

function parseRow(row: unknown): ComparisonRow {
  if (!isRecord(row) || typeof row.id !== 'string' || typeof row.label !== 'string') {
    fail('each row needs an id and a label');
  }
  const { id, label, home, cells } = row;
  if (typeof home !== 'boolean') fail(`${id}: home must be true or false`);
  const ours = isRecord(cells) ? cells['Field Notes'] : undefined;
  if (
    !isRecord(ours) ||
    typeof ours.href !== 'string' ||
    !(
      ours.href.startsWith('/docs/') ||
      ours.href === '/roadmap/' ||
      ours.href.startsWith(REPOSITORY) ||
      ours.href === BUNDLEPHOBIA
    )
  ) {
    fail(
      `${id}/Field Notes: href must be a docs page, /roadmap/, the repository or the Bundlephobia page`,
    );
  }
  const parsed: ComparisonRow = {
    id,
    label,
    home,
    cells: { 'Field Notes': { text: cellText(ours, `${id}/Field Notes`), href: ours.href } },
  };
  for (const column of OTHER_COLUMNS) {
    const cell = isRecord(cells) ? cells[column] : undefined;
    if (cell === undefined) continue;
    const where = `${id}/${column}`;
    if (!isRecord(cell) || typeof cell.source !== 'string' || !cell.source.startsWith('https://')) {
      fail(`${where}: source must be an https URL`);
    }
    if (typeof cell.checkedOn !== 'string' || !ISO_DATE.test(cell.checkedOn)) {
      fail(`${where}: checkedOn must be YYYY-MM-DD`);
    }
    parsed.cells[column] = {
      text: cellText(cell, where),
      source: cell.source,
      checkedOn: cell.checkedOn,
    };
  }
  return parsed;
}

/** Validates `comparison.json`; throws on the first violation. */
export function parseComparison(json: unknown): Comparison {
  if (!isRecord(json) || typeof json.checkedOn !== 'string' || !ISO_DATE.test(json.checkedOn)) {
    fail('checkedOn must be YYYY-MM-DD');
  }
  if (JSON.stringify(json.columns) !== JSON.stringify(COLUMNS)) {
    fail(`columns must be ${COLUMNS.join(', ')}`);
  }
  if (!Array.isArray(json.rows)) fail('rows must be a list');
  return { checkedOn: json.checkedOn, columns: COLUMNS, rows: json.rows.map(parseRow) };
}
