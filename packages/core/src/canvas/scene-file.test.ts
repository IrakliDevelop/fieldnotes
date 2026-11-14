/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { MAX_SCENE_FILE_BYTES, readSceneFile } from './scene-file';
import { appendItxtChunk } from './png-chunks';
import { exportState } from '../core/state-serializer';
import type { CanvasState } from '../core/state-serializer';
import { createShape } from '../elements/element-factory';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4,
  0x89,
];
const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const minimalPng = new Uint8Array([...SIGNATURE, ...IHDR, ...IEND]);

const shape = {
  ...createShape({ position: { x: 10, y: 20 }, size: { w: 30, h: 40 }, layerId: 'l1' }),
  index: 'a0',
};
const layer = { id: 'l1', name: 'L', visible: true, locked: false, order: 0, opacity: 1 };
const state = (): CanvasState =>
  exportState([shape], { position: { x: 0, y: 0 }, zoom: 1 }, [layer]);
const envelope = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'fieldnotes/scene', version: 1, state: state(), ...overrides });
const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pngFile = (bytes: Uint8Array<ArrayBuffer>) =>
  new File([bytes], 'board.png', { type: 'image/png' });
const svgFile = (body: string) =>
  new File([`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`], 'board.svg', {
    type: 'image/svg+xml',
  });

describe('readSceneFile', () => {
  it.each([
    ['board.fieldnotes', ''],
    ['board.json', ''],
    ['Board.FIELDNOTES', ''],
    ['Board.JSON', ''],
    ['board', 'application/json'],
    ['board', 'application/vnd.fieldnotes+json'],
  ])('reads a board file named %s with type %s', async (name, type) => {
    const file = new File([JSON.stringify(state())], name, { type });

    expect((await readSceneFile(file))?.elements).toEqual([shape]);
  });

  it('reads the scene from a PNG iTXt chunk', async () => {
    const file = pngFile(appendItxtChunk(minimalPng, 'fieldnotes:scene', envelope()));

    expect(await readSceneFile(file)).toEqual(state());
  });

  it('reads the scene from an untyped PNG named with an upper-case extension', async () => {
    const bytes = appendItxtChunk(minimalPng, 'fieldnotes:scene', envelope());

    expect(await readSceneFile(new File([bytes], 'Scene.PNG'))).toEqual(state());
  });

  it('returns null for a PNG without a scene or with only a foreign iTXt chunk', async () => {
    const xmp = appendItxtChunk(minimalPng, 'XML:com.adobe.xmp', envelope());

    expect(await readSceneFile(pngFile(new Uint8Array(minimalPng)))).toBeNull();
    expect(await readSceneFile(pngFile(xmp))).toBeNull();
  });

  it('reads the scene from SVG metadata and returns null without metadata', async () => {
    expect(await readSceneFile(svgFile(`<metadata>${escapeXml(envelope())}</metadata>`))).toEqual(
      state(),
    );
    expect(await readSceneFile(svgFile('<rect width="1" height="1"/>'))).toBeNull();
  });

  it.each([
    ['a foreign envelope type', { type: 'other' }],
    ['envelope version 2', { version: 2 }],
    [
      'an invalid state',
      {
        state: {
          ...state(),
          elements: [{ ...shape, type: 'stroke', points: undefined }],
        },
      },
    ],
  ])('returns null for %s', async (_, overrides) => {
    const file = pngFile(appendItxtChunk(minimalPng, 'fieldnotes:scene', envelope(overrides)));

    expect(await readSceneFile(file)).toBeNull();
  });

  it('migrates an older board file through the state parser', async () => {
    const legacy = { ...state(), version: 5 };
    const file = new File([JSON.stringify(legacy)], 'old.fieldnotes');

    expect((await readSceneFile(file))?.version).toBe(6);
  });

  it('returns null for an oversize file before reading it', async () => {
    class Huge extends Blob {
      override get size(): number {
        return MAX_SCENE_FILE_BYTES + 1;
      }
    }
    const file = new Huge([JSON.stringify(state())], { type: 'application/json' });
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer');
    const text = vi.spyOn(file, 'text');

    expect(await readSceneFile(file)).toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it('returns null for a valid scene chunk declaring more than 16 MiB', async () => {
    const padded = envelope() + ' '.repeat(16 * 1024 * 1024);
    const bytes = appendItxtChunk(minimalPng, 'fieldnotes:scene', padded);

    expect(new DataView(bytes.buffer).getUint32(33)).toBeGreaterThan(16 * 1024 * 1024);
    expect(await readSceneFile(pngFile(bytes))).toBeNull();
  }, 30_000);
});
