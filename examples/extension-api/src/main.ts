import { Viewport, SelectTool, HandTool, PencilTool } from '@fieldnotes/core';
import { annotationPlugin, AnnotationServiceKey } from './annotation-plugin';
import { AnnotationTool } from './annotation-tool';

// ─── Create the viewport with the annotation plugin ──────────────────────────
// The plugin is installed at construction time. Its configure() registers the
// element type and render hooks; its start() sets up the service and listeners.

const container = document.getElementById('canvas');
if (!(container instanceof HTMLElement)) throw new Error('Missing #canvas container');

const viewport = new Viewport(container, {
  background: { pattern: 'dots', spacing: 24 },
  plugins: [annotationPlugin],
});

// ─── Register tools ──────────────────────────────────────────────────────────
const selectTool = new SelectTool();
const handTool = new HandTool();
const pencilTool = new PencilTool({ color: '#1a1a1a', width: 2 });
const annotationTool = new AnnotationTool();

viewport.toolManager.register(selectTool);
viewport.toolManager.register(handTool);
viewport.toolManager.register(pencilTool);
viewport.toolManager.register(annotationTool);

viewport.setTool('select');

// ─── Toolbar wiring ──────────────────────────────────────────────────────────
const buttons = document.querySelectorAll<HTMLButtonElement>('.toolbar button[data-tool]');

function setActive(name: string): void {
  buttons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === name);
  });
}

buttons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    if (tool) {
      viewport.setTool(tool);
      setActive(tool);
    }
  });
});

viewport.toolManager.onChange((name) => setActive(name));

// ─── Demonstrate service access ──────────────────────────────────────────────
// The host app (or other plugins) can retrieve the typed service from the viewport.

viewport.store.on('add', () => {
  const service = viewport.getService(AnnotationServiceKey);
  if (service) {
    console.log(`Annotations: ${service.count}, colors: [${service.colors.join(', ')}]`);
  }
});
