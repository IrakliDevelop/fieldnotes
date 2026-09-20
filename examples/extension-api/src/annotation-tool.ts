import type { Tool, ToolContext, PointerState } from '@fieldnotes/core';
import type { AnnotationElement } from './annotation-element';
import { annotationDefinition } from './annotation-element';

// ─── Custom tool that places annotation elements ──────────────────────────────
// Demonstrates how a tool creates extension elements via the registry's wrap().

const COLORS = ['#e74c3c', '#2ecc71', '#3498db', '#f39c12', '#9b59b6', '#1abc9c'];

export class AnnotationTool implements Tool {
  readonly name = 'annotation';
  private colorIndex = 0;

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });

    const element: AnnotationElement = {
      id: crypto.randomUUID(),
      type: 'example:annotation',
      position: { x: world.x, y: world.y },
      zIndex: ctx.store.getAll().length,
      locked: false,
      layerId: ctx.activeLayerId ?? '',
      label: `Note ${this.colorIndex + 1}`,
      color: COLORS[this.colorIndex % COLORS.length] ?? '#e74c3c',
      radius: 20,
    };

    // wrap() converts the typed element to an ExtensionElementEnvelope for storage.
    const envelope = annotationDefinition.wrap(element);
    ctx.store.add(envelope);
    ctx.requestRender();

    this.colorIndex++;
  }

  onPointerMove(_state: PointerState, _ctx: ToolContext): void {
    // Single-click placement — no drag behavior
  }
  onPointerUp(_state: PointerState, _ctx: ToolContext): void {
    // Placement committed on pointer down
  }

  onActivate(ctx: { setCursor?: (cursor: string) => void }): void {
    ctx.setCursor?.('crosshair');
  }

  onDeactivate(ctx: { setCursor?: (cursor: string) => void }): void {
    ctx.setCursor?.('default');
  }
}
