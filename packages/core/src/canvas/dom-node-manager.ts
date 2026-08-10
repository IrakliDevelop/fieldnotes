import type { CanvasElement, HtmlElement } from '../elements/types';
import type { ElementStore } from '../elements/element-store';
import { DEFAULT_NOTE_FONT_SIZE } from '../elements/element-factory';
import { DoubleTapDetector } from './double-tap-detector';
export interface DomNodeManagerDeps {
  domLayer: HTMLDivElement;
  onEditRequest: (id: string) => void;
  isEditingElement: (id: string) => boolean;
  getVersion?: (id: string) => number;
}

export class DomNodeManager {
  private domNodes = new Map<string, HTMLDivElement>();
  private strata = new Map<number, HTMLDivElement>();
  private htmlContent = new Map<string, HTMLElement>();
  /** Elements whose node carries host-supplied content (see `markHostOwnedContent`). */
  private hostOwnedContent = new Set<string>();
  /** Host-owned nodes removed from the DOM but kept alive for a later remount. */
  private preservedNodes = new Map<string, HTMLDivElement>();
  private readonly domLayer: HTMLDivElement;
  private readonly onEditRequest: (id: string) => void;
  private readonly isEditingElement: (id: string) => boolean;
  private readonly getVersion: ((id: string) => number) | null;
  private lastSyncedVersion = new Map<string, number>();
  private lastSyncedZIndex = new Map<string, number>();
  private lastSyncedOpacity = new Map<string, number>();
  private cameraTransform = '';

  constructor(deps: DomNodeManagerDeps) {
    this.domLayer = deps.domLayer;
    this.onEditRequest = deps.onEditRequest;
    this.isEditingElement = deps.isEditingElement;
    this.getVersion = deps.getVersion ?? null;
  }

  getNode(id: string): HTMLDivElement | undefined {
    return this.domNodes.get(id);
  }

  setCameraTransform(transform: string): void {
    if (transform === this.cameraTransform) return;
    this.cameraTransform = transform;
    for (const stratum of this.strata.values()) stratum.style.transform = transform;
  }

  storeHtmlContent(elementId: string, dom: HTMLElement): void {
    this.htmlContent.set(elementId, dom);
    // Content arriving (or changing) is not reflected in the element's own data version, so
    // the dirty-tracking fast path in syncDomNode must be invalidated explicitly — otherwise a
    // contentless node stuck at pointerEvents:'none' (G2) would never re-render once content
    // shows up.
    this.lastSyncedVersion.delete(elementId);
  }

  /**
   * Marks an element's node as carrying content the HOST mounted into it directly
   * (`ViewportOptions.onHtmlElementMount`). That content is never recorded in
   * `htmlContent` — the host appends straight into the node — so a detach would
   * destroy it and no remount could ever bring it back. Preserving the node itself
   * (rather than a guessed-at child) keeps arbitrary subtrees, host-attached
   * listeners, and the host's own reference to the node all valid.
   *
   * Callers mark UNCONDITIONALLY, without inspecting the node — a host that only attaches
   * listeners or styles owns its node just as much as one that appended children, and
   * there is no way to tell those apart from the outside. Two consequences follow, both
   * accepted: a node the host never populated can still round-trip back into the DOM (the
   * documented exception to "never had content -> never remount", reachable only via
   * `onHtmlElementMount`), and one detached `<div>` is retained per such element for its
   * lifetime.
   */
  markHostOwnedContent(elementId: string): void {
    this.hostOwnedContent.add(elementId);
  }

  hasContent(elementId: string): boolean {
    return this.htmlContent.has(elementId);
  }

  resetHtmlContent(elementId: string): void {
    this.htmlContent.delete(elementId);
    // Replacing an element's content ends host ownership: the caller owns it now, and a
    // stale preserved node would remount the OLD content ahead of the new.
    this.hostOwnedContent.delete(elementId);
    this.preservedNodes.delete(elementId);
    this.lastSyncedVersion.delete(elementId);
    this.lastSyncedZIndex.delete(elementId);
    this.lastSyncedOpacity.delete(elementId);
    const node = this.domNodes.get(elementId);
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
    delete node.dataset['initialized'];
  }

  syncDomNode(element: CanvasElement, zIndex = 0, opacity = 1): void {
    let node = this.domNodes.get(element.id);
    if (!node) {
      const preserved = this.preservedNodes.get(element.id);
      if (preserved) {
        // Host-owned node coming back from a canvas detour: reattach the ORIGINAL node so
        // the host's content survives. A fresh node here would be permanently empty.
        this.preservedNodes.delete(element.id);
        node = preserved;
      } else {
        node = document.createElement('div');
        node.dataset['elementId'] = element.id;
        Object.assign(node.style, {
          position: 'absolute',
          pointerEvents: 'auto',
        });
      }
      this.getStratum(zIndex).appendChild(node);
      this.domNodes.set(element.id, node);
    } else if (this.getVersion) {
      const currentVersion = this.getVersion(element.id);
      const lastVersion = this.lastSyncedVersion.get(element.id);
      const lastZ = this.lastSyncedZIndex.get(element.id);
      const lastOpacity = this.lastSyncedOpacity.get(element.id);
      if (lastVersion === currentVersion && lastZ === zIndex && lastOpacity === opacity) {
        return;
      }
    }

    if (node.parentElement !== this.getStratum(zIndex)) {
      const previousStratum = node.parentElement;
      this.getStratum(zIndex).appendChild(node);
      if (previousStratum?.childElementCount === 0) {
        const previousOrder = Number(previousStratum.dataset['paintOrder']);
        previousStratum.remove();
        this.strata.delete(previousOrder);
      }
    }

    if (this.getVersion) {
      this.lastSyncedVersion.set(element.id, this.getVersion(element.id));
      this.lastSyncedZIndex.set(element.id, zIndex);
      this.lastSyncedOpacity.set(element.id, opacity);
    }

    const size = 'size' in element ? element.size : null;
    Object.assign(node.style, {
      display: 'block',
      left: `${element.position.x}px`,
      top: `${element.position.y}px`,
      width: size ? `${size.w}px` : 'auto',
      height: size ? `${size.h}px` : 'auto',
      zIndex: String(zIndex),
      opacity: String(opacity),
      transform: element.rotation ? `rotate(${element.rotation}rad)` : '',
      transformOrigin: '50% 50%',
    });

    this.renderDomContent(node, element);
  }

  hideDomNode(id: string): void {
    const node = this.domNodes.get(id);
    if (node) {
      node.style.display = 'none';
      this.lastSyncedVersion.delete(id);
    }
  }

  removeDomNode(id: string): void {
    this.htmlContent.delete(id);
    this.hostOwnedContent.delete(id);
    this.preservedNodes.delete(id);
    this.detachNodeElement(id);
  }

  /** Removes the node but KEEPS htmlContent, so a later re-mount restores the original embed.
   *  The registry factory that produces embed content only runs in loadState (G1), so dropping
   *  content here would be unrecoverable. For a host-owned node there is no recorded content at
   *  all, so the node ITSELF is kept alive off-DOM and reattached by `syncDomNode`.
   *  Use `removeDomNode` when the element itself is gone. */
  detachDomNode(id: string): void {
    if (this.hostOwnedContent.has(id)) {
      const node = this.domNodes.get(id);
      if (node) this.preservedNodes.set(id, node);
    }
    this.detachNodeElement(id);
  }

  /** Shared by `removeDomNode` and `detachDomNode`: clears dirty-tracking caches, removes the
   *  node from the DOM, and cleans up its stratum if now empty. Does NOT touch `htmlContent` —
   *  that distinction is each caller's own responsibility. */
  private detachNodeElement(id: string): void {
    this.lastSyncedVersion.delete(id);
    this.lastSyncedZIndex.delete(id);
    this.lastSyncedOpacity.delete(id);
    const node = this.domNodes.get(id);
    if (!node) return;
    const stratum = node.parentElement;
    node.remove();
    this.domNodes.delete(id);
    if (stratum?.childElementCount === 0) {
      const order = Number(stratum.dataset['paintOrder']);
      stratum.remove();
      this.strata.delete(order);
    }
  }

  /** Reconciles BOTH directions synchronously. Canvas/missing routing detaches the node
   *  (content preserved); dom routing remounts preserved content immediately, so a painter
   *  unregistration does not wait for an unrelated render pass. */
  reconcileHtmlRouting(
    store: ElementStore,
    resolve: (el: HtmlElement) => 'dom' | 'canvas' | 'missing',
  ): void {
    for (const el of store.getElementsByType('html')) {
      if (resolve(el) !== 'dom') {
        this.detachDomNode(el.id);
        continue;
      }
      // Reverse transition: only meaningful when content — recorded content, or a preserved
      // host-owned node — survived a detach.
      if (
        (this.htmlContent.has(el.id) || this.preservedNodes.has(el.id)) &&
        !this.domNodes.has(el.id)
      ) {
        this.syncDomNode(el);
      }
    }
  }

  clearDomNodes(): void {
    this.domNodes.forEach((node) => node.remove());
    this.domNodes.clear();
    this.htmlContent.clear();
    this.hostOwnedContent.clear();
    this.preservedNodes.clear();
    this.lastSyncedVersion.clear();
    this.lastSyncedZIndex.clear();
    this.lastSyncedOpacity.clear();
    for (const stratum of this.strata.values()) stratum.remove();
    this.strata.clear();
  }

  private getStratum(order: number): HTMLDivElement {
    let stratum = this.strata.get(order);
    if (stratum) return stratum;
    stratum = document.createElement('div');
    stratum.dataset['paintOrder'] = String(order);
    Object.assign(stratum.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      transformOrigin: '0 0',
      transform: this.cameraTransform,
      zIndex: String(order),
    });
    this.domLayer.appendChild(stratum);
    this.strata.set(order, stratum);
    return stratum;
  }

  reattachHtmlContent(store: ElementStore): void {
    for (const el of store.getElementsByType('html')) {
      if (el.domId) {
        const dom = document.getElementById(el.domId);
        if (dom) {
          this.htmlContent.set(el.id, dom);
        }
      }
    }
  }

  private renderDomContent(node: HTMLDivElement, element: CanvasElement): void {
    if (element.type === 'note') {
      if (!node.dataset['initialized']) {
        node.dataset['initialized'] = 'true';
        Object.assign(node.style, {
          backgroundColor: element.backgroundColor,
          color: element.textColor,
          padding: '8px',
          borderRadius: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          fontSize: `${element.fontSize ?? DEFAULT_NOTE_FONT_SIZE}px`,
          overflow: 'hidden',
          cursor: 'default',
          userSelect: 'none',
          wordWrap: 'break-word',
        });
        node.innerHTML = element.text || '';

        // One-time per node: this pointerup/double-tap listener is attached once (guarded by
        // `initialized`) for note/text nodes and is GC'd with the node — no teardown.
        // `resetHtmlContent()` (the only path clearing `initialized`) is html-only, and the html
        // init branch attaches no listener, so re-init is safe. INVARIANT: never call
        // resetHtmlContent on a note/text node, and if you add a listener to the html init branch,
        // add matching teardown in resetHtmlContent — else a second listener would stack.
        const detector = new DoubleTapDetector();
        node.addEventListener('pointerup', (e) => {
          if (detector.feed(e)) {
            e.stopPropagation();
            const id = node.dataset['elementId'];
            if (id) this.onEditRequest(id);
          }
        });
      }

      if (!this.isEditingElement(element.id)) {
        const text = element.text || '';
        if (node.innerHTML !== text) {
          node.innerHTML = text;
        }
        node.style.backgroundColor = element.backgroundColor;
        node.style.color = element.textColor;
        node.style.fontSize = `${element.fontSize ?? DEFAULT_NOTE_FONT_SIZE}px`;
      }
    }

    if (element.type === 'html') {
      const content = this.htmlContent.get(element.id);
      if (!node.dataset['initialized']) {
        if (content) {
          node.dataset['initialized'] = 'true';
          Object.assign(node.style, {
            overflow: 'hidden',
            pointerEvents: element.interactive ? 'auto' : 'none',
          });
          node.appendChild(content);
        } else {
          // G2: a contentless html node must not swallow pointer events. This is what an
          // unknown htmlType on an older client produces.
          node.style.pointerEvents = 'none';
        }
      } else {
        node.style.pointerEvents = element.interactive ? 'auto' : 'none';
      }
    }

    if (element.type === 'text') {
      if (!node.dataset['initialized']) {
        node.dataset['initialized'] = 'true';
        Object.assign(node.style, {
          padding: '2px',
          fontSize: `${element.fontSize}px`,
          color: element.color,
          textAlign: element.textAlign,
          background: 'none',
          border: 'none',
          boxShadow: 'none',
          overflow: 'visible',
          cursor: 'default',
          userSelect: 'none',
          wordWrap: 'break-word',
          lineHeight: '1.4',
        });
        node.innerHTML = element.text || '';

        // One-time per node; see the note branch above for the one-listener-per-node invariant.
        const detector = new DoubleTapDetector();
        node.addEventListener('pointerup', (e) => {
          if (detector.feed(e)) {
            e.stopPropagation();
            const id = node.dataset['elementId'];
            if (id) this.onEditRequest(id);
          }
        });
      }

      if (!this.isEditingElement(element.id)) {
        const text = element.text || '';
        if (node.innerHTML !== text) {
          node.innerHTML = text;
        }
        Object.assign(node.style, {
          fontSize: `${element.fontSize}px`,
          color: element.color,
          textAlign: element.textAlign,
        });
      }
    }
  }
}
