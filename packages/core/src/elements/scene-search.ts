import type { ElementRegistry } from './element-registry';
import { DEFAULT_NOTE_FONT_SIZE } from './element-factory';
import { parseStyledRuns } from './note-sanitizer';
import type { CanvasElement } from './types';

interface Entry {
  readonly text: string;
  readonly folded: string;
}

interface Match {
  readonly element: CanvasElement;
  readonly entry: Entry;
  readonly at: number;
}

/** A text match on an element in the scene. */
export interface SceneSearchHit {
  readonly id: string;
  readonly type: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Options for a scene text search. */
export interface SceneSearchOptions {
  readonly limit?: number;
  readonly filter?: (element: CanvasElement) => boolean;
}

/** Folds text for case- and diacritic-insensitive matching. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ');
}

/** Searches the text-bearing elements in a scene. */
export class SceneSearch {
  private readonly entries = new WeakMap<CanvasElement, Entry | null>();

  constructor(private readonly registry: ElementRegistry) {}

  search(
    elements: readonly CanvasElement[],
    query: string,
    options: SceneSearchOptions = {},
  ): SceneSearchHit[] {
    const foldedQuery = foldText(query).trim();
    if (!foldedQuery) return [];

    const matches: Match[] = [];
    for (const element of elements) {
      if (options.filter && !options.filter(element)) continue;
      const entry = this.entryFor(element);
      if (!entry) continue;
      const at = entry.folded.indexOf(foldedQuery);
      if (at !== -1) matches.push({ element, entry, at });
    }

    matches.sort((a, b) => a.at - b.at);
    return matches.slice(0, options.limit ?? 20).map(({ element, entry, at }) => {
      const targetEnd = at + foldedQuery.length;
      let foldedOffset = 0;
      let sourceOffset = 0;
      let start = 0;
      let end = entry.text.length;
      let inWhitespace = false;

      for (const ch of entry.text) {
        const nextSourceOffset = sourceOffset + ch.length;
        const folded = /\s/u.test(ch) ? (inWhitespace ? '' : ' ') : foldText(ch);
        inWhitespace = /\s/u.test(ch);
        const nextFoldedOffset = foldedOffset + folded.length;

        if (at >= foldedOffset && at < nextFoldedOffset) start = sourceOffset;
        if (targetEnd > foldedOffset && targetEnd <= nextFoldedOffset) end = nextSourceOffset;

        foldedOffset = nextFoldedOffset;
        sourceOffset = nextSourceOffset;
      }

      return {
        id: element.id,
        type: element.type === 'extension' ? element.extensionType : element.type,
        text: entry.text,
        start,
        end,
      };
    });
  }

  private entryFor(element: CanvasElement): Entry | null {
    if (this.entries.has(element)) return this.entries.get(element) ?? null;

    const text = this.extractText(element);
    const entry = text?.trim() ? { text, folded: foldText(text) } : null;
    this.entries.set(element, entry);
    return entry;
  }

  private extractText(element: CanvasElement): string | null {
    switch (element.type) {
      case 'note':
      case 'text':
        return parseStyledRuns(element.text, element.fontSize ?? DEFAULT_NOTE_FONT_SIZE)
          .map((run) => run.text)
          .join('');
      case 'arrow':
        return element.label ?? null;
      case 'extension': {
        const searchText = this.registry.getAdapter(element.extensionType)?.searchText;
        if (!searchText) return null;
        try {
          const text = searchText(element);
          if (text === null || typeof text === 'string') return text;
          console.error(`[fieldnotes] searchText failed for "${element.extensionType}"`, text);
        } catch (error) {
          console.error(`[fieldnotes] searchText failed for "${element.extensionType}"`, error);
        }
        return null;
      }
      default:
        return null;
    }
  }
}
