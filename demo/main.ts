import {
  Viewport,
  VERSION,
  HandTool,
  PencilTool,
  EraserTool,
  SelectTool,
  ArrowTool,
  NoteTool,
  AutoSave,
} from '@fieldnotes/core';

console.log(`Field Notes v${VERSION}`);

const container = document.getElementById('canvas');
if (!container) throw new Error('Missing #canvas element');

const viewport = new Viewport(container, {
  background: { pattern: 'dots', spacing: 24, color: '#c0c0c0' },
});

const hand = new HandTool();
const pencil = new PencilTool({ color: '#1a1a1a', width: 2 });
const eraser = new EraserTool();
const select = new SelectTool();
const arrow = new ArrowTool({ color: '#1a1a1a', width: 2 });
const note = new NoteTool();

viewport.toolManager.register(hand);
viewport.toolManager.register(pencil);
viewport.toolManager.register(eraser);
viewport.toolManager.register(select);
viewport.toolManager.register(arrow);
viewport.toolManager.register(note);

const autoSave = new AutoSave(viewport.store, viewport.camera);
const savedState = autoSave.load();
if (savedState) {
  viewport.loadState(savedState);
  console.log('Restored auto-saved state');
}
autoSave.start();

viewport.toolManager.setTool('select', viewport.toolContext);

function setActiveTool(name: string) {
  viewport.toolManager.setTool(name, viewport.toolContext);
  document.querySelectorAll<HTMLButtonElement>('#toolbar button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset['tool'] === name);
  });
}

viewport.toolManager.onChange((name) => {
  document.querySelectorAll<HTMLButtonElement>('#toolbar button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset['tool'] === name);
  });
});

document.getElementById('toolbar')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  const toolName = btn?.dataset['tool'];
  if (toolName) setActiveTool(toolName);
});

const fileInput = document.getElementById('image-file') as HTMLInputElement | null;

fileInput?.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    if (typeof src !== 'string') return;
    const rect = container.getBoundingClientRect();
    const center = viewport.camera.screenToWorld({
      x: rect.width / 2,
      y: rect.height / 2,
    });
    viewport.addImage(src, { x: center.x - 150, y: center.y - 100 });
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});

document.getElementById('image-btn')?.addEventListener('click', () => {
  fileInput?.click();
});

document.getElementById('embed-btn')?.addEventListener('click', () => {
  const widget = document.createElement('div');
  Object.assign(widget.style, {
    padding: '12px',
    background: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '14px',
  });
  const title = document.createElement('strong');
  title.textContent = 'HTML Widget';

  const desc = document.createElement('p');
  Object.assign(desc.style, { margin: '8px 0 4px', color: '#666' });
  desc.textContent = 'This is an embedded DOM element.';

  const btn = document.createElement('button');
  Object.assign(btn.style, {
    padding: '4px 12px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    cursor: 'pointer',
  });
  btn.textContent = 'Click me';
  btn.addEventListener('click', () => {
    btn.textContent = 'Clicked!';
    console.log('HTML widget button clicked!');
  });

  widget.appendChild(title);
  widget.appendChild(desc);
  widget.appendChild(btn);
  const rect = container.getBoundingClientRect();
  const center = viewport.camera.screenToWorld({
    x: rect.width / 2,
    y: rect.height / 2,
  });
  viewport.addHtmlElement(widget, { x: center.x - 100, y: center.y - 75 });
});

document.getElementById('brush-sizes')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.brush-size') as HTMLButtonElement | null;
  if (!btn?.dataset['width']) return;
  const width = Number(btn.dataset['width']);
  pencil.setOptions({ width });
  arrow.setOptions({ width });
  document.querySelectorAll('.brush-size').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
});

const colorInput = document.getElementById('tool-color') as HTMLInputElement | null;

colorInput?.addEventListener('input', (e) => {
  const color = (e.target as HTMLInputElement).value;
  pencil.setOptions({ color });
  arrow.setOptions({ color });
  note.setOptions({ backgroundColor: color });
});

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).isContentEditable) return;
  if (e.target instanceof HTMLInputElement) return;

  const map: Record<string, string> = {
    h: 'hand',
    v: 'select',
    p: 'pencil',
    e: 'eraser',
    a: 'arrow',
    n: 'note',
  };
  const tool = map[e.key];
  if (tool) {
    setActiveTool(tool);
  }
  if (e.key === 'i') {
    fileInput?.click();
  }
});

const undoBtn = document.getElementById('undo') as HTMLButtonElement | null;
const redoBtn = document.getElementById('redo') as HTMLButtonElement | null;

function updateHistoryButtons() {
  if (undoBtn) undoBtn.disabled = !viewport.history.canUndo;
  if (redoBtn) redoBtn.disabled = !viewport.history.canRedo;
}

viewport.history.onChange(updateHistoryButtons);

undoBtn?.addEventListener('click', () => {
  viewport.undo();
});

redoBtn?.addEventListener('click', () => {
  viewport.redo();
});

document.getElementById('save')?.addEventListener('click', () => {
  const json = viewport.exportJSON();
  console.log(`State snapshot (${json.length} bytes)`);
});

document.getElementById('load')?.addEventListener('click', () => {
  const saved = autoSave.load();
  if (!saved) {
    console.warn('No saved state found');
    return;
  }
  viewport.loadState(saved);
  console.log('State restored from auto-save');
});

const info = document.getElementById('info');
if (info) {
  const updateInfo = () => {
    const { x, y } = viewport.camera.position;
    const z = viewport.camera.zoom;
    const tool = viewport.toolManager.activeTool?.name ?? 'none';
    info.textContent = `${tool} · ${z.toFixed(2)}x · (${x.toFixed(0)}, ${y.toFixed(0)}) · Scroll=zoom · Middle/Space+drag=pan · Pinch=zoom`;
  };
  viewport.camera.onChange(updateInfo);
  viewport.toolManager.onChange(updateInfo);
  updateInfo();
}
