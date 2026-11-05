import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createArrow,
  createHtmlElement,
  createNote,
  createShape,
  createText,
} from './element-factory';
import { ElementRegistry } from './element-registry';
import { createFrame } from './frame-element';
import { getDefaultElementRegistry } from './default-registry';
import { SceneSearch } from './scene-search';
import { createBoundText } from './bound-text';
import type { ElementTypeDefinition, ExtensionElementEnvelope } from './types';

function extension(
  id: string,
  extensionType: string,
  data: Record<string, unknown>,
): ExtensionElementEnvelope {
  return {
    id,
    type: 'extension',
    extensionType,
    position: { x: 0, y: 0 },
    index: '',
    version: 1,
    locked: false,
    layerId: '',
    data,
  };
}

function labelDefinition(type: string): ElementTypeDefinition<ExtensionElementEnvelope> {
  return {
    type,
    legacyTypes: [],
    decodeLegacy: () => extension('legacy', type, {}),
    validateData: () => true,
    unwrap: (element) => element,
    wrap: (element) => element,
    bounds: () => null,
    searchText: (element) => String(element.data['name']),
  };
}

describe('SceneSearch', () => {
  it('finds bound arrow text once after a cached legacy label', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, label: 'legacy' });
    const text = createBoundText(arrow, { text: 'bound' });
    const search = new SceneSearch(getDefaultElementRegistry());

    expect(search.search([arrow], 'legacy')).toHaveLength(1);
    expect(search.search([arrow, text], 'bound').map((hit) => hit.id)).toEqual([text.id]);
    expect(search.search([arrow, text], 'legacy')).toEqual([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds note text across a line break and decodes entities', () => {
    const note = createNote({
      position: { x: 0, y: 0 },
      text: '<div>Budget <b>2026</b></div><div>caf&eacute; &amp; tea</div>',
    });
    const search = new SceneSearch(getDefaultElementRegistry());

    expect(search.search([note], 'cafe')).toEqual([
      { id: note.id, type: 'note', text: 'Budget 2026\ncafé & tea', start: 12, end: 16 },
    ]);
    expect(search.search([note], 'budget 2026 caf')).toEqual([
      { id: note.id, type: 'note', text: 'Budget 2026\ncafé & tea', start: 0, end: 15 },
    ]);
  });

  it('matches a text element, an arrow label and a frame title', () => {
    const text = createText({ position: { x: 0, y: 0 }, text: 'Hello' });
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, label: 'yes' });
    const frame = createFrame({
      position: { x: 0, y: 0 },
      size: { w: 80, h: 48 },
      title: 'Roadmap',
    });
    const search = new SceneSearch(getDefaultElementRegistry());

    expect(search.search([text], 'hell')).toEqual([
      { id: text.id, type: 'text', text: 'Hello', start: 0, end: 4 },
    ]);
    expect(search.search([arrow], 'YES')).toEqual([
      { id: arrow.id, type: 'arrow', text: 'yes', start: 0, end: 3 },
    ]);
    expect(search.search([frame], 'road')).toEqual([
      { id: frame.id, type: 'core:frame', text: 'Roadmap', start: 0, end: 4 },
    ]);
  });

  it('uses searchText of a registered extension type', () => {
    const registry = new ElementRegistry(getDefaultElementRegistry());
    registry.register(labelDefinition('test:label'));
    const element = extension('label', 'test:label', { name: 'Alpha' });

    expect(new SceneSearch(registry).search([element], 'alp')).toEqual([
      { id: 'label', type: 'test:label', text: 'Alpha', start: 0, end: 3 },
    ]);
  });

  it('isolates a searchText that throws or returns a non-string', () => {
    const registry = new ElementRegistry(getDefaultElementRegistry());
    const error = new Error('boom');
    registry.register({
      ...labelDefinition('test:bad'),
      searchText: (element) => {
        if (element.data['mode'] === 'throw') throw error;
        return JSON.parse('42');
      },
    });
    registry.register(labelDefinition('test:label'));
    const throwing = extension('throwing', 'test:bad', { mode: 'throw' });
    const invalid = extension('invalid', 'test:bad', { mode: 'invalid' });
    const good = extension('good', 'test:label', { name: 'Alpha' });
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const search = new SceneSearch(registry);

    expect(search.search([throwing, invalid, good], 'alp')).toEqual([
      { id: 'good', type: 'test:label', text: 'Alpha', start: 0, end: 3 },
    ]);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenNthCalledWith(
      1,
      '[fieldnotes] searchText failed for "test:bad"',
      error,
    );
    expect(report).toHaveBeenNthCalledWith(2, '[fieldnotes] searchText failed for "test:bad"', 42);

    search.search([throwing, invalid, good], 'alp');
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('ignores shapes, html elements, empty text and whitespace queries', () => {
    const shape = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const html = createHtmlElement({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const empty = createNote({ position: { x: 0, y: 0 }, text: '<div><br></div>' });
    const search = new SceneSearch(getDefaultElementRegistry());

    expect(search.search([shape, html, empty], 'anything')).toEqual([]);
    expect(search.search([shape], '   ')).toEqual([]);
    expect(search.search([shape], '')).toEqual([]);
  });

  it('folds case and diacritics without drifting indices', () => {
    const istanbul = createNote({ position: { x: 0, y: 0 }, text: 'İstanbul' });
    const emoji = createNote({ position: { x: 0, y: 0 }, text: '🙂 hi' });
    const whitespace = createNote({ position: { x: 0, y: 0 }, text: 'one \n\t  two' });
    const search = new SceneSearch(getDefaultElementRegistry());

    expect(search.search([istanbul], 'ist')).toEqual([
      { id: istanbul.id, type: 'note', text: 'İstanbul', start: 0, end: 3 },
    ]);
    expect(search.search([emoji], 'hi')).toEqual([
      { id: emoji.id, type: 'note', text: '🙂 hi', start: 3, end: 5 },
    ]);
    expect(search.search([whitespace], 'two')).toEqual([
      { id: whitespace.id, type: 'note', text: 'one \n\t  two', start: 8, end: 11 },
    ]);
  });

  it('keeps a combining mark with an empty fold transparent to whitespace state', () => {
    const note = createNote({ position: { x: 0, y: 0 }, text: 'a ́ bxyz' });
    const search = new SceneSearch(getDefaultElementRegistry());

    expect(search.search([note], 'xyz')).toEqual([
      { id: note.id, type: 'note', text: 'a ́ bxyz', start: 5, end: 8 },
    ]);
  });

  it('orders by match position then scene order and applies limit and filter', () => {
    const a = createNote({ position: { x: 0, y: 0 }, text: 'the cat' });
    const b = createNote({ position: { x: 0, y: 0 }, text: 'cat' });
    const c = createNote({ position: { x: 0, y: 0 }, text: 'a cat' });
    const d = createNote({ position: { x: 0, y: 0 }, text: 'cat one' });
    const e = createNote({ position: { x: 0, y: 0 }, text: 'cat two' });
    const search = new SceneSearch(getDefaultElementRegistry());

    expect(search.search([a, b, c, d, e], 'cat').map((hit) => hit.id)).toEqual([
      b.id,
      d.id,
      e.id,
      c.id,
      a.id,
    ]);
    expect(search.search([a, b, c, d, e], 'cat', { limit: 2 }).map((hit) => hit.id)).toEqual([
      b.id,
      d.id,
    ]);
    expect(
      search
        .search([a, b, c, d, e], 'cat', { filter: (element) => element.id !== b.id })
        .map((hit) => hit.id),
    ).toEqual([d.id, e.id, c.id, a.id]);
  });

  it('hits the same element object again without recomputing visible state', () => {
    const note = createNote({ position: { x: 0, y: 0 }, text: 'Alpha' });
    const search = new SceneSearch(getDefaultElementRegistry());

    const first = search.search([note], 'alp');
    note.text = 'Beta';
    expect(search.search([note], 'alp')).toEqual([
      { id: note.id, type: 'note', text: 'Alpha', start: 0, end: 3 },
    ]);
    expect(first).toEqual([{ id: note.id, type: 'note', text: 'Alpha', start: 0, end: 3 }]);
    expect(search.search([{ ...note, text: 'Beta' }], 'bet')).toEqual([
      { id: note.id, type: 'note', text: 'Beta', start: 0, end: 3 },
    ]);
  });
});
