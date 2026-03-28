import type { CanvasElement } from '../elements/types';
import type { ElementStore } from '../elements/element-store';

export interface DomNodeManagerDeps {
  domLayer: HTMLDivElement;
  onEditRequest: (id: string) => void;
  isEditingElement: (id: string) => boolean;
}

export class DomNodeManager {
  private domNodes = new Map<string, HTMLDivElement>();
  private htmlContent = new Map<string, HTMLElement>();
  private readonly domLayer: HTMLDivElement;
  private readonly onEditRequest: (id: string) => void;
  private readonly isEditingElement: (id: string) => boolean;

  constructor(deps: DomNodeManagerDeps) {
    this.domLayer = deps.domLayer;
    this.onEditRequest = deps.onEditRequest;
    this.isEditingElement = deps.isEditingElement;
  }

  getNode(id: string): HTMLDivElement | undefined {
    return this.domNodes.get(id);
  }

  storeHtmlContent(elementId: string, dom: HTMLElement): void {
    this.htmlContent.set(elementId, dom);
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
          fontSize: '14px',
          overflow: 'hidden',
          cursor: 'default',
          userSelect: 'none',
          wordWrap: 'break-word',
        });
        node.textContent = element.text || '';

        node.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const id = node.dataset['elementId'];
          if (id) this.onEditRequest(id);
        });
      }

      if (!this.isEditingElement(element.id)) {
        if (node.textContent !== element.text) {
          node.textContent = element.text || '';
        }
        node.style.backgroundColor = element.backgroundColor;
        node.style.color = element.textColor;
      }
    }

    if (element.type === 'html' && !node.dataset['initialized']) {
      const content = this.htmlContent.get(element.id);
      if (content) {
        node.dataset['initialized'] = 'true';
        Object.assign(node.style, {
          overflow: 'hidden',
          pointerEvents: 'none',
        });
        node.appendChild(content);
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

        node.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const id = node.dataset['elementId'];
          if (id) this.onEditRequest(id);
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
