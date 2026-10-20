import { Viewport, PencilTool, SelectTool } from '@fieldnotes/core';

const container = document.getElementById('canvas');
const template = document.getElementById('live-template');
if (!container || !(template instanceof HTMLTemplateElement)) {
  throw new Error('Missing #canvas or #live-template');
}
const live = template.content.firstElementChild;
if (!(live instanceof HTMLElement)) throw new Error('Empty #live-template');

const viewport = new Viewport(container, {
  embedded: true,
  background: { pattern: 'dots', spacing: 24, color: '#c0c0c0' },
});
viewport.toolManager.register(new SelectTool());
viewport.toolManager.register(new PencilTool({ color: '#1a1a1a', width: 2 }));
viewport.setTool('select');

// #live-text ends 8px past the 640px board edge, so focusing it scrolls the wrapper.
viewport.addHtmlElement(live, { x: 392, y: 120 }, { w: 280, h: 180 }, { interactive: true });

const count = live.querySelector('#live-count');
live.querySelector('#live-btn')?.addEventListener('click', () => {
  if (count) count.textContent = String(Number(count.textContent) + 1);
});

document.getElementById('engage')?.addEventListener('click', () => {
  viewport.setEmbeddedEngaged(true);
});
document.getElementById('done')?.addEventListener('click', () => {
  viewport.setEmbeddedEngaged(false);
});

const globals = window as unknown as Record<string, unknown>;
globals.__fieldnotes_viewport = viewport;
globals.__fn_passthrough = 0;
globals.__fn_engaged = viewport.isEmbeddedEngaged();
viewport.onWheelPassThrough(() => {
  globals.__fn_passthrough = Number(globals.__fn_passthrough) + 1;
});
viewport.onEmbeddedEngagedChange((engaged) => {
  globals.__fn_engaged = engaged;
});
