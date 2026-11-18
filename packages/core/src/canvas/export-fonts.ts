/** One font file to embed in an SVG export. */
export interface ExportFontFace {
  readonly family: string;
  /** Default 'normal'. */
  readonly weight?: 'normal' | 'bold';
  /** Default 'normal'. */
  readonly style?: 'normal' | 'italic';
  /** A URL to fetch with CORS, or the font bytes. */
  readonly src: string | Blob;
}

/** Why embedding a font face failed. */
export type ExportFontErrorReason = 'load' | 'timeout' | 'encode';

/** Details of a font face that could not be embedded. */
export interface ExportFontError {
  /** CSS font family requested for export. */
  readonly family: string;
  /** Normalized font weight. */
  readonly weight: 'normal' | 'bold';
  /** Normalized font style. */
  readonly style: 'normal' | 'italic';
  /** Why embedding failed. */
  readonly reason: ExportFontErrorReason;
  /** Underlying fetch or encoding failure, when available. */
  readonly cause?: unknown;
}

/** Font embedding options for SVG export. */
export interface ExportFontOptions {
  /** Faces to embed as `@font-face`; only faces the export uses are loaded. */
  fonts?: readonly ExportFontFace[];
  /** Called when a face cannot be embedded; without it the failure is logged with `console.warn`. The export continues with the family name only. */
  onFontError?: (error: ExportFontError) => void;
}

interface NormalizedFace extends ExportFontFace {
  readonly weight: 'normal' | 'bold';
  readonly style: 'normal' | 'italic';
}

function normalize(face: ExportFontFace): NormalizedFace {
  return { ...face, weight: face.weight ?? 'normal', style: face.style ?? 'normal' };
}

function fontMime(type: string, src: ExportFontFace['src']): string {
  const essence = type.split(';', 1)[0]?.trim().toLowerCase();
  if (
    essence === 'font/woff2' ||
    essence === 'font/woff' ||
    essence === 'font/ttf' ||
    essence === 'font/otf'
  ) {
    return essence;
  }
  const name =
    typeof src === 'string'
      ? src
      : typeof File !== 'undefined' && src instanceof File
        ? src.name
        : '';
  const path = name.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.woff')) return 'font/woff';
  if (path.endsWith('.ttf')) return 'font/ttf';
  if (path.endsWith('.otf')) return 'font/otf';
  return 'application/octet-stream';
}

/** Selects supplied faces that occur in the active stack and emitted text styles. */
export function selectFaces(
  fonts: readonly ExportFontFace[],
  stack: string,
  used: ReadonlySet<string>,
): NormalizedFace[] {
  const families = stack.split(',').map((family) => {
    const trimmed = family.trim();
    return /^(['"]).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
  });
  return fonts
    .map(normalize)
    .filter((face) => families.includes(face.family) && used.has(`${face.weight}/${face.style}`));
}

/** Builds the CSS rule for an embedded face. */
export function fontFaceCss(face: ExportFontFace, dataUrl: string): string {
  const normalized = normalize(face);
  const family = normalized.family.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `@font-face{font-family:"${family}";font-weight:${normalized.weight};font-style:${normalized.style};src:url("${dataUrl}")}`;
}

/** Encodes bytes as a single base64 string. */
export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function report(error: ExportFontError, onFontError: ExportFontOptions['onFontError']): void {
  if (onFontError) {
    onFontError(error);
    return;
  }
  console.warn(
    `[fieldnotes] font "${error.family}" ${error.weight} ${error.style} not embedded: ${error.reason}`,
  );
}

function errorFor(
  face: NormalizedFace,
  reason: ExportFontErrorReason,
  cause?: unknown,
): ExportFontError {
  return { family: face.family, weight: face.weight, style: face.style, reason, cause };
}

class FontEncodeError {
  constructor(readonly cause: unknown) {}
}

/** Loads faces and returns CSS rules for the faces that encoded successfully. */
export async function loadFontFaces(
  faces: readonly ExportFontFace[],
  timeoutMs: number,
  onFontError?: (error: ExportFontError) => void,
): Promise<string[]> {
  return Promise.all(
    faces.map(async (face) => {
      const normalized = normalize(face);
      const controller = new AbortController();
      const timeout = Symbol('font-timeout');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          (async () => {
            let blob: Blob;
            if (typeof normalized.src === 'string') {
              if (typeof fetch !== 'function') throw new Error('fetch is unavailable');
              const response = await fetch(normalized.src, { signal: controller.signal });
              if (!response.ok) throw new Error(`font request failed: ${response.status}`);
              blob = await response.blob();
            } else {
              blob = normalized.src;
            }
            try {
              return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
            } catch (cause) {
              throw new FontEncodeError(cause);
            }
          })(),
          new Promise<typeof timeout>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve(timeout);
            }, timeoutMs);
          }),
        ]);
        if (result === timeout) {
          report(errorFor(normalized, 'timeout'), onFontError);
          return '';
        }
        if (result.bytes.length === 0) {
          report(errorFor(normalized, 'encode'), onFontError);
          return '';
        }
        const mime = fontMime(result.mime, normalized.src);
        return fontFaceCss(normalized, `data:${mime};base64,${base64(result.bytes)}`);
      } catch (cause) {
        report(
          errorFor(
            normalized,
            cause instanceof FontEncodeError ? 'encode' : 'load',
            cause instanceof FontEncodeError ? cause.cause : cause,
          ),
          onFontError,
        );
        return '';
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }),
  ).then((css) => css.filter(Boolean));
}
