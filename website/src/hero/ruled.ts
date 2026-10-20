import type { Viewport } from '@fieldnotes/core';

const RULE_GAP = 28;
// The static picture's first rule sits at 39px (its 12px offset plus 27px), so the lines do not jump.
const RULE_PHASE = 11;

/** Draws ruled paper and the margin line in world space under every element. */
export function ruledPaper(viewport: Viewport, marginX: number): void {
  const tokens = getComputedStyle(document.documentElement);
  const rule = tokens.getPropertyValue('--rule').trim();
  const margin = tokens.getPropertyValue('--margin').trim();
  viewport.renderHooks.viewport.register({
    beforeElements(ctx, camera, { width, height }) {
      const { zoom, position } = camera;
      const top = -position.y / zoom;
      const bottom = (height - position.y) / zoom;
      ctx.fillStyle = rule;
      const first = Math.ceil((top - RULE_PHASE) / RULE_GAP) * RULE_GAP + RULE_PHASE;
      for (let y = first; y <= bottom; y += RULE_GAP) {
        ctx.fillRect(0, Math.round(y * zoom + position.y), width, 1);
      }
      ctx.fillStyle = margin;
      ctx.fillRect(marginX * zoom + position.x, 0, 1.5, height);
    },
  });
}
