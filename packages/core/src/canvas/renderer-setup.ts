import type { ElementRenderer } from '../elements/element-renderer';
import type { ElementStore } from '../elements/element-store';
import type { ElementRegistry } from '../elements/element-registry';
import type { Camera } from './camera';
import type { ResolvedTheme } from './theme';
import type { HtmlElements } from './html-elements';
import type { ImageErrorInfo } from './content-inserter';

export interface RendererSetupDeps {
  renderer: ElementRenderer;
  theme: ResolvedTheme;
  store: ElementStore;
  camera: Camera;
  elementRegistry: ElementRegistry;
  html: HtmlElements;
  onImageError: ((info: ImageErrorInfo) => void) | undefined;
  markLayerDirty: (layerId: string) => void;
  requestRender: () => void;
}

/** Returns the image-error reporter, which the content inserter reuses. */
export function configureRenderer(deps: RendererSetupDeps): (info: ImageErrorInfo) => void {
  const { renderer, store, html } = deps;
  renderer.setTheme(deps.theme);
  renderer.setStore(store);
  renderer.setCamera(deps.camera);
  renderer.setElementRegistry(deps.elementRegistry);
  renderer.setOnImageLoad((src) => {
    for (const el of store.getAll()) {
      if (el.type === 'image' && el.src === src) deps.markLayerDirty(el.layerId);
    }
    deps.requestRender();
  });
  const reportImageError = (info: ImageErrorInfo): void => {
    if (deps.onImageError) deps.onImageError(info);
    else console.warn(`[fieldnotes] image failed to ${info.reason ?? 'load'}: ${info.src}`);
  };
  renderer.setOnImageError((src, cause) => {
    const elementIds: string[] = [];
    for (const el of store.getAll()) {
      if (el.type === 'image' && el.src === src) elementIds.push(el.id);
    }
    reportImageError({ src, elementIds, cause, reason: 'load' });
  });
  renderer.setHtmlPainters(html.painters);
  renderer.setDiagnosticSink((d) => {
    html.diagnostics.emit(d, {
      registryVersion: html.painters.version,
      elementVersion: store.getVersion(d.elementId),
    });
  });
  return reportImageError;
}
