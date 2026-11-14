import type { CanvasState } from '../core/state-serializer';
import type { ElementRegistry } from '../elements/element-registry';
import { parseState, parseStateValue } from '../core/state-serializer';
import { findItxtChunk } from './png-chunks';
import { MAX_SCENE_EMBED_BYTES, SCENE_METADATA_TYPE, SCENE_PNG_KEYWORD } from './scene-embed';

/** File extension of a saved Field Notes board. */
export const FIELDNOTES_FILE_EXTENSION = '.fieldnotes';
/** MIME type of a saved Field Notes board. */
export const FIELDNOTES_MIME_TYPE = 'application/vnd.fieldnotes+json';
export const MAX_SCENE_FILE_BYTES = 64 * 1024 * 1024;

interface FileLike {
  name?: string;
  type: string;
}

const nameEndsWith = (file: FileLike, ...suffixes: string[]) =>
  suffixes.some((suffix) => file.name?.toLowerCase().endsWith(suffix) === true);

export function isBoardFile(file: FileLike): boolean {
  return (
    file.type === FIELDNOTES_MIME_TYPE ||
    file.type === 'application/json' ||
    nameEndsWith(file, FIELDNOTES_FILE_EXTENSION, '.json')
  );
}

export function isSceneImageFile(file: FileLike): boolean {
  return file.type === 'image/png' || file.type === 'image/svg+xml';
}

export function isTextFile(file: FileLike): boolean {
  return (
    file.type === 'text/plain' || file.type === 'text/markdown' || nameEndsWith(file, '.txt', '.md')
  );
}

/** Reads a board file or the scene embedded in an exported PNG or SVG; `null` when there is none. */
export async function readSceneFile(
  file: Blob & { name?: string },
  registry?: ElementRegistry,
): Promise<CanvasState | null> {
  if (file.size > MAX_SCENE_FILE_BYTES) return null;
  try {
    if (file.type === 'image/png' || nameEndsWith(file, '.png')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return parseEnvelope(
        findItxtChunk(bytes, SCENE_PNG_KEYWORD, MAX_SCENE_EMBED_BYTES),
        registry,
      );
    }
    if (file.type === 'image/svg+xml' || nameEndsWith(file, '.svg')) {
      const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
      const metadata = doc.documentElement.querySelector(':scope > metadata')?.textContent;
      return parseEnvelope(metadata ?? null, registry);
    }
    if (isBoardFile(file)) return parseState(await file.text(), registry);
  } catch {
    // Untrusted file content: any parse or validation failure means "no scene".
  }
  return null;
}

function parseEnvelope(json: string | null, registry?: ElementRegistry): CanvasState | null {
  if (json === null) return null;
  const data: unknown = JSON.parse(json);
  if (
    typeof data !== 'object' ||
    data === null ||
    !('type' in data) ||
    data.type !== SCENE_METADATA_TYPE ||
    !('version' in data) ||
    data.version !== 1 ||
    !('state' in data) ||
    typeof data.state !== 'object'
  ) {
    return null;
  }
  return parseStateValue(data.state, registry);
}
