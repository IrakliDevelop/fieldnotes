import type { CanvasElement } from '../elements/types';
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
  private htmlContent = new Map<string, HTMLElement>();
  private readonly domLayer: HTMLDivElement;
  private readonly onEditRequest: (id: string) => void;
  private readonly isEditingElement: (id: string) => boolean;
  private readonly getVersion: ((id: string) => number) | null;
  private lastSyncedVersion = new Map<string, number>();
  private lastSyncedZIndex = new Map<string, number>();

  constructor(deps: DomNodeManagerDeps) {
    this.domLayer = deps.domLayer;
    this.onEditRequest = deps.onEditRequest;
    this.isEditingElement = deps.isEditingElement;
    this.getVersion = deps.getVersion ?? null;
  }

  getNode(id: string): HTMLDivElement | undefined {
    return this.domNodes.get(id);
  }

  storeHtmlContent(elementId: string, dom: HTMLElement): void {
    this.htmlContent.set(elementId, dom);
  }

  hasContent(elementId: string): boolean {
    return this.htmlContent.has(elementId);
  }

  resetHtmlContent(elementId: string): void {
    this.htmlContent.delete(elementId);
    this.lastSyncedVersion.delete(elementId);
    const node = this.domNodes.get(elementId);
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
    delete node.dataset['initialized'];
  }

  syncDomNode(element: CanvasElement, zIndex = 0): void {
    let node = this.domNodes.get(element.id);
    if (!node) {
      node = document.createElement('div');
      node.dataset['elementId'] = element.id;
      Object.assign(node.style, {
        position: 'absolute',
        pointerEvents: 'auto',
      });
      this.domLayer.appendChild(node);
      this.domNodes.set(element.id, node);
    } else if (this.getVersion) {
      const currentVersion = this.getVersion(element.id);
      const lastVersion = this.lastSyncedVersion.get(element.id);
      const lastZ = this.lastSyncedZIndex.get(element.id);
      if (lastVersion === currentVersion && lastZ === zIndex) {
        return;
      }
    }

    if (this.getVersion) {
      this.lastSyncedVersion.set(element.id, this.getVersion(element.id));
      this.lastSyncedZIndex.set(element.id, zIndex);
    }

    const size = 'size' in element ? element.size : null;
    Object.assign(node.style, {
      display: 'block',
      left: `${element.position.x}px`,
      top: `${element.position.y}px`,
      width: size ? `${size.w}px` : 'auto',
      height: size ? `${size.h}px` : 'auto',
      zIndex: String(zIndex),
    });

    this.renderDomContent(node, element);
  }

  hideDomNode(id: string): void {
    const node = this.domNodes.get(id);
    if (node) node.style.display = 'none';
  }

  removeDomNode(id: string): void {
    this.htmlContent.delete(id);
    this.lastSyncedVersion.delete(id);
    this.lastSyncedZIndex.delete(id);
    const node = this.domNodes.get(id);
    if (node) {
      node.remove();
      this.domNodes.delete(id);
    }
  }

  clearDomNodes(): void {
    this.domNodes.forEach((node) => node.remove());
    this.domNodes.clear();
    this.htmlContent.clear();
    this.lastSyncedVersion.clear();
    this.lastSyncedZIndex.clear();
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
      if (!node.dataset['initialized']) {
        const content = this.htmlContent.get(element.id);
        if (content) {
          node.dataset['initialized'] = 'true';
          Object.assign(node.style, {
            overflow: 'hidden',
            pointerEvents: element.interactive ? 'auto' : 'none',
          });
          node.appendChild(content);
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
          whiteSpace: 'pre-wrap',
          lineHeight: '1.4',
        });
        node.textContent = element.text || '';

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
        if (node.textContent !== element.text) {
          node.textContent = element.text || '';
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
