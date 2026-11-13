// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  FIELDNOTES_CLIPBOARD_TYPE,
  MAX_CLIPBOARD_CHARS,
  decodeClipboard,
  encodeClipboard,
  hasClipboardMarker,
} from './clipboard-codec';
import {
  createArrow,
  createHtmlElement,
  createNote,
  createShape,
  createStroke,
} from '../elements/element-factory';
import { getDefaultElementRegistry } from '../elements/default-registry';

const registry = getDefaultElementRegistry();
const origin = { x: 0, y: 0 };
const box = { position: origin, size: { w: 10, h: 10 } };

function envelope(fields: Record<string, unknown>): string {
  return JSON.stringify({
    type: FIELDNOTES_CLIPBOARD_TYPE,
    version: 1,
    stateVersion: 6,
    elements: [createShape({ ...box, index: 'a0' })],
    ...fields,
  });
}

describe('clipboard codec', () => {
  it('round trips elements without peer-only fields', () => {
    const note = createNote({
      position: origin,
      index: 'a0',
      text: 'say &quot;hi&quot; &lt;/div&gt; ✓<br>two',
    });
    const shape = createShape({ ...box, index: 'a1' });
    shape.link = 'https://x.y';
    const arrow = createArrow({
      index: 'a2',
      from: origin,
      to: { x: 50, y: 50 },
      toBinding: { elementId: shape.id },
    });
    const expected = [note, shape, arrow].map((el) => ({ ...el, layerId: 'default-layer' }));
    note.editor = 'peer';
    Object.assign(shape, { ownerId: 'owner' });
    Object.assign(arrow, { audience: 'gm' });

    expect(decodeClipboard(encodeClipboard([note, shape, arrow]), registry)).toEqual(expected);
  });

  it('reads vendor before html', () => {
    const a = createNote({ position: origin, index: 'a0', text: 'A' });
    const b = createNote({ position: origin, index: 'a0', text: 'B' });
    const decoded = decodeClipboard({
      vendor: encodeClipboard([a]).vendor,
      html: encodeClipboard([b]).html,
    });
    expect(decoded?.map((el) => el.id)).toEqual([a.id]);
  });

  it('html envelope decodes when vendor is empty', () => {
    const shape = createShape({ ...box, index: 'a0' });
    const { html } = encodeClipboard([shape]);
    expect(decodeClipboard({ vendor: '', html, text: 'plain' })?.map((el) => el.id)).toEqual([
      shape.id,
    ]);
  });

  it('text/plain JSON envelope decodes and counts as a marker', () => {
    const shape = createShape({ ...box, index: 'a0' });
    const { text } = encodeClipboard([shape]);
    expect(decodeClipboard({ text })?.map((el) => el.id)).toEqual([shape.id]);
    expect(hasClipboardMarker({ text: `  ${text}` })).toBe(true);
  });

  it('foreign html and text are not a marker and decode to null', () => {
    const payload = { html: '<p>hello</p>', text: 'hello' };
    expect(hasClipboardMarker(payload)).toBe(false);
    expect(decodeClipboard(payload)).toBeNull();
  });

  it('a malformed element decodes to null', () => {
    const stroke = createStroke({ index: 'a0', points: [{ x: 0, y: 0, pressure: 0.5 }] });
    const vendor = envelope({ elements: [{ ...stroke, points: undefined }] });
    expect(hasClipboardMarker({ vendor })).toBe(true);
    expect(decodeClipboard({ vendor })).toBeNull();
  });

  it.each([
    ['version 2', { version: 2 }],
    ['stateVersion 7', { stateVersion: 7 }],
    ['wrong type', { type: 'other/clipboard' }],
  ])('%s decodes to null', (_, fields) => {
    expect(decodeClipboard({ vendor: envelope({}) })).not.toBeNull();
    expect(decodeClipboard({ vendor: envelope(fields) })).toBeNull();
  });

  it('input above the cap decodes to null', { timeout: 30_000 }, () => {
    const payload = { text: 'x'.repeat(MAX_CLIPBOARD_CHARS + 1) };
    expect(decodeClipboard(payload)).toBeNull();
    expect(hasClipboardMarker(payload)).toBe(false);
  });

  it('encode strips transient html and writes readable text', () => {
    const one = createNote({ position: origin, index: 'a0', text: 'one<br>two &amp; <b>x</b>' });
    const two = createNote({ position: origin, index: 'a1', text: '<div>three</div>' });
    expect(encodeClipboard([one, two]).text).toBe('one\ntwo & x\n\nthree');

    const shape = createShape({ ...box, index: 'a0' });
    const transient = createHtmlElement({ ...box, index: 'a1', transient: true });
    const { vendor, html, text } = encodeClipboard([shape, transient]);
    expect(text).toBe(vendor);
    expect(html).toContain('data-fieldnotes="');
    const attribute = new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelector('[data-fieldnotes]')
      ?.getAttribute('data-fieldnotes');
    expect(JSON.parse(attribute ?? 'null')).toEqual(JSON.parse(vendor));
    const parsed: unknown = JSON.parse(vendor);
    expect(parsed).toMatchObject({ type: 'fieldnotes/clipboard', version: 1, stateVersion: 6 });
    expect((parsed as { elements: { id: string }[] }).elements.map((el) => el.id)).toEqual([
      shape.id,
    ]);
  });
});
