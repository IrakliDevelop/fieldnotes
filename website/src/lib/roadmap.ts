/** The public roadmap, one item per line in each section. */
export interface Roadmap {
  built: string[];
  next: string[];
  notBuilt: string[];
}

const TITLES = ['Built', 'Next', 'Not built yet'];

/** Parses `roadmap.md`: exactly the H2s "Built", "Next" and "Not built yet", each a flat `- ` list. */
export function parseRoadmap(markdown: string): Roadmap {
  const sections = new Map<string, string[]>();
  let items: string[] | undefined;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim();
      if (!TITLES.includes(title) || sections.has(title)) {
        throw new Error(`roadmap.md: unexpected section "${title}"`);
      }
      items = [];
      sections.set(title, items);
    } else if (items === undefined || line.trim() === '') {
      continue;
    } else if (/^\s+[-*+] /.test(line)) {
      throw new Error(`roadmap.md: nested bullet "${line}"`);
    } else if (line.startsWith('- ')) {
      items.push(line.slice(2).trim());
    } else {
      throw new Error(`roadmap.md: expected a "- " bullet, found "${line}"`);
    }
  }
  const section = (title: string) => {
    const list = sections.get(title);
    if (list === undefined) throw new Error(`roadmap.md: missing section "${title}"`);
    return list;
  };
  return { built: section('Built'), next: section('Next'), notBuilt: section('Not built yet') };
}
