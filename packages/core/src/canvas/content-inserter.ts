import type { Point } from '../core/types';
import type { CanvasState } from '../core/state-serializer';
import type { ElementStore } from '../elements/element-store';
import type { ElementRegistry } from '../elements/element-registry';
import type { CanvasElement } from '../elements/types';
import { createText } from '../elements/element-factory';
import { escapePlainTextHtml } from '../elements/note-sanitizer';
import { measureText } from '../elements/text-measure';
import { isBoardFile, isSceneImageFile, isTextFile, readSceneFile } from './scene-file';

/** Why the host is being asked to upload an image. */
export interface AssetUploadContext {
  kind: 'drop' | 'paste' | 'import';
}

/** Host upload for dropped, pasted and imported images; resolves to the hosted `src`. */
export interface AssetResolver {
  upload(file: File, context: AssetUploadContext): Promise<{ src: string }>;
}

/** An image that failed to load or upload; `elementIds` is empty when nothing was inserted. */
export interface ImageErrorInfo {
  src: string;
  elementIds: string[];
  cause?: unknown;
  reason?: 'load' | 'upload';
}

export type InsertKind = 'drop' | 'paste';

export const MAX_PASTE_TEXT_CHARS = 10_000;
export const MAX_TEXT_FILE_BYTES = 40_000;
export const PASTE_TEXT_MAX_WIDTH = 400;
export const IMAGE_BOX = { w: 300, h: 200 } as const;

/** Escapes plain text into the line-broken HTML the text editor produces; `''` when blank. */
export function textHtmlFromPlain(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').slice(0, MAX_PASTE_TEXT_CHARS);
  if (normalized.trim() === '') return '';
  return normalized.split('\n').map(escapePlainTextHtml).join('<br>');
}

export interface ContentInserterDeps {
  store: ElementStore;
  elementRegistry: ElementRegistry;
  getActiveLayerId: () => string;
  getTextStyle: () => { fontSize: number; color: string } | null;
  insertElements: (elements: CanvasElement[], anchor: Point) => boolean;
  insertWhenIdle: (run: () => void) => void;
  transaction: (run: () => void) => void;
  switchToSelect: () => void;
  setSelection: (ids: string[]) => void;
  requestRender: () => void;
  addImage: (src: string, topLeft: Point) => string;
  assets?: AssetResolver;
  onImageError: (info: ImageErrorInfo) => void;
}

/** Turns pasted or dropped text, image files and imported elements into undoable inserts. */
export class ContentInserter {
  constructor(private readonly deps: ContentInserterDeps) {}

  insertText(text: string, anchor: Point, link?: string): string | null {
    const html = textHtmlFromPlain(text);
    if (html === '') return null;
    const { fontSize, color } = this.deps.getTextStyle() ?? { fontSize: 16, color: '#1a1a1a' };
    const w = Math.min(PASTE_TEXT_MAX_WIDTH, measureText(html, fontSize, null).w);
    const h = measureText(html, fontSize, w).h;
    const el = createText({
      position: { x: anchor.x - w / 2, y: anchor.y - h / 2 },
      size: { w, h },
      text: html,
      fontSize,
      color,
      wrap: true,
      autoResize: true,
      layerId: this.deps.getActiveLayerId(),
    });
    if (link !== undefined) el.link = link;
    this.deps.switchToSelect();
    this.deps.transaction(() => this.deps.store.add(el));
    this.deps.setSelection([el.id]);
    this.deps.requestRender();
    return el.id;
  }

  insertElements(elements: CanvasElement[], anchor: Point): void {
    if (!elements.some((el) => this.needsRehost(el))) {
      this.deps.insertElements(elements, anchor);
      return;
    }
    void this.rehostAll(elements).then((kept) =>
      this.deps.insertWhenIdle(() => this.deps.insertElements(kept, anchor)),
    );
  }

  claimsFile(file: { name?: string; type: string }, kind: InsertKind): boolean {
    return (
      file.type.startsWith('image/') || isBoardFile(file) || (kind === 'drop' && isTextFile(file))
    );
  }

  insertFiles(files: readonly File[], anchor: Point, kind: InsertKind): boolean {
    const jobs = files
      .filter((file) => this.claimsFile(file, kind))
      .map((file) => this.fileJob(file, anchor, kind));
    if (jobs.length === 0) return false;
    void Promise.allSettled(jobs).then((results) =>
      this.deps.insertWhenIdle(() => {
        const ids = results.flatMap((result) =>
          result.status === 'fulfilled' ? result.value() : [],
        );
        if (ids.length === 0) return;
        this.deps.switchToSelect();
        this.deps.setSelection(ids);
      }),
    );
    return true;
  }

  // Classification order matches claimsFile: scene image, other image, board file, then text on drop.
  private async fileJob(file: File, anchor: Point, kind: InsertKind): Promise<() => string[]> {
    const registry = this.deps.elementRegistry;
    if (file.type.startsWith('image/')) {
      const state = isSceneImageFile(file) ? await readSceneFile(file, registry) : null;
      return state ? this.sceneJob(state, anchor) : this.imageJob(file, anchor, kind);
    }
    if (isBoardFile(file)) {
      const state = await readSceneFile(file, registry);
      return state ? this.sceneJob(state, anchor) : () => [];
    }
    const text = await file.slice(0, MAX_TEXT_FILE_BYTES).text();
    return () => {
      const id = this.insertText(text, anchor);
      return id === null ? [] : [id];
    };
  }

  // The file's layers, camera and plugin state stay out: elements land on the active layer.
  private async sceneJob(state: CanvasState, anchor: Point): Promise<() => string[]> {
    const hidden = new Set(state.layers?.filter((l) => l.visible === false).map((l) => l.id));
    const kept = await this.rehostAll(state.elements.filter((el) => !hidden.has(el.layerId)));
    return () => {
      this.deps.insertElements(kept, anchor);
      return [];
    };
  }

  private async imageJob(file: File, anchor: Point, kind: InsertKind): Promise<() => string[]> {
    const { assets } = this.deps;
    let src: string;
    try {
      src = assets ? (await assets.upload(file, { kind })).src : await readAsDataUrl(file);
    } catch (cause) {
      this.deps.onImageError({
        src: file.name,
        elementIds: [],
        cause,
        reason: assets ? 'upload' : 'load',
      });
      throw cause;
    }
    const topLeft = { x: anchor.x - IMAGE_BOX.w / 2, y: anchor.y - IMAGE_BOX.h / 2 };
    return () => [this.deps.addImage(src, topLeft)];
  }

  // With a resolver no inline image reaches synced state; without one, only tab-scoped blob: is unsafe.
  private needsRehost(el: CanvasElement): boolean {
    if (el.type !== 'image') return false;
    return (
      el.src.startsWith('blob:') || (this.deps.assets !== undefined && el.src.startsWith('data:'))
    );
  }

  private async rehostAll(elements: CanvasElement[]): Promise<CanvasElement[]> {
    const results = await Promise.allSettled(elements.map((el) => this.rehost(el)));
    return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  }

  private async rehost(el: CanvasElement): Promise<CanvasElement> {
    if (el.type !== 'image' || !this.needsRehost(el)) return el;
    const { assets } = this.deps;
    try {
      const blob = await (await fetch(el.src)).blob();
      const src = assets
        ? (await assets.upload(new File([blob], 'image', { type: blob.type }), { kind: 'import' }))
            .src
        : await readAsDataUrl(blob);
      return { ...el, src };
    } catch (cause) {
      this.deps.onImageError({ src: el.src, elementIds: [el.id], cause, reason: 'upload' });
      throw cause;
    }
  }
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('FileReader returned no data URL'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
