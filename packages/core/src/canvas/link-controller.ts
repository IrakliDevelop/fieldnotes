import type { Camera } from './camera';
import type { ResolvedTheme } from './theme';
import type { ElementStore } from '../elements/element-store';
import type { LayerManager } from '../layers/layer-manager';
import type { ElementRegistry } from '../elements/element-registry';
import { parseElementLink } from '../elements/link';
import { openLinkPrompt } from './link-prompt';
import { getElementVisualBounds } from '../elements/element-bounds';
import { CameraAnimator } from './camera-animator';
import { revealView } from './palette-model';

export interface LinkControllerDeps {
  store: ElementStore;
  layerManager: LayerManager;
  elementRegistry: ElementRegistry;
  camera: Camera;
  container: HTMLElement;
  wrapper: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- mirrors ViewportOptions.onOpenLink
  onOpenLink: ((link: string, event: PointerEvent | null) => boolean | void) | undefined;
  getTheme: () => ResolvedTheme;
  getCanvasSize: () => { w: number; h: number };
  stopCameraMotion: () => void;
  closeContextMenu: () => void;
  /** Switches to the select tool if needed and selects the one element. */
  selectElement: (id: string) => void;
  setLink: (ids: readonly string[], link: string | null) => void;
}

export class LinkController {
  private linkAnimator: CameraAnimator | null = null;
  private linkPromptClose: (() => void) | null = null;

  constructor(private readonly deps: LinkControllerDeps) {}

  open(id: string, event: PointerEvent | null): void {
    const link = this.deps.store.getById(id)?.link;
    if (link === undefined) return;
    if (this.deps.onOpenLink?.(link, event) === true) return;
    const target = parseElementLink(link);
    if (target !== null) {
      this.revealElement(target);
      return;
    }
    window.open(link, '_blank', 'noopener,noreferrer');
  }

  prompt(ids: readonly string[], initial: string, label: string): void {
    this.deps.closeContextMenu();
    this.linkPromptClose?.();
    const frozen = [...ids];
    this.linkPromptClose = openLinkPrompt({
      container: this.deps.container,
      wrapper: this.deps.wrapper,
      getTheme: () => this.deps.getTheme(),
      initialValue: initial,
      label,
      // A peer may delete or lock an id while the prompt is open.
      onSubmit: (link) => {
        const ids = frozen.filter((id) => {
          const el = this.deps.store.getById(id);
          return (
            el !== undefined && !el.locked && !this.deps.layerManager.isLayerLocked(el.layerId)
          );
        });
        if (ids.length > 0) this.deps.setLink(ids, link);
      },
      onClose: () => {
        this.linkPromptClose = null;
      },
    });
  }

  closePrompt(): void {
    this.linkPromptClose?.();
  }

  disposeAnimator(): void {
    this.linkAnimator?.dispose();
  }

  private revealElement(id: string): void {
    const el = this.deps.store.getById(id);
    if (!el || !this.deps.layerManager.isLayerVisible(el.layerId)) return;
    const bounds = getElementVisualBounds(el, this.deps.elementRegistry);
    if (!bounds) return;
    this.deps.stopCameraMotion();
    const { w, h } = this.deps.getCanvasSize();
    const view = revealView(bounds, this.deps.camera.getVisibleRect(w, h));
    if (this.linkAnimator === null) {
      this.linkAnimator = new CameraAnimator(this.deps.wrapper, this.deps.camera, {
        getCanvasSize: () => this.deps.getCanvasSize(),
        interactive: true,
      });
    }
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
      this.linkAnimator.jumpTo(view);
    else this.linkAnimator.animateTo(view);
    this.deps.selectElement(id);
  }
}
