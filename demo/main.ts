import {
  Viewport,
  VERSION,
  HandTool,
  PencilTool,
  EraserTool,
  SelectTool,
  ArrowTool,
  NoteTool,
  TextTool,
  ShapeTool,
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
const text = new TextTool();
const shape = new ShapeTool({ strokeColor: '#1a1a1a' });

viewport.toolManager.register(hand);
viewport.toolManager.register(pencil);
viewport.toolManager.register(eraser);
viewport.toolManager.register(select);
viewport.toolManager.register(arrow);
viewport.toolManager.register(note);
viewport.toolManager.register(text);
viewport.toolManager.register(shape);

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

const brushSlider = document.getElementById('brush-size') as HTMLInputElement | null;
const brushPreview = document.getElementById('brush-preview');
const brushLabel = document.getElementById('brush-label');

brushSlider?.addEventListener('input', () => {
  const width = Number(brushSlider.value);
  pencil.setOptions({ width });
  arrow.setOptions({ width });
  shape.setOptions({ strokeWidth: width });
  if (brushPreview) {
    const size = Math.max(4, width + 4);
    brushPreview.style.width = `${size}px`;
    brushPreview.style.height = `${size}px`;
  }
  if (brushLabel) brushLabel.textContent = `${width}px`;
});

const notePanel = document.getElementById('note-panel');
const noteBgInput = document.getElementById('note-bg') as HTMLInputElement | null;
const noteTextColorInput = document.getElementById('note-text-color') as HTMLInputElement | null;

function getSelectedNoteElement() {
  const ids = select.selectedIds;
  if (ids.length !== 1) return null;
  const el = viewport.store.getAll().find((e) => e.id === ids[0]);
  if (el && el.type === 'note') return el;
  return null;
}

function updateNotePanel() {
  const activeTool = viewport.toolManager.activeTool?.name;
  const selectedNote = getSelectedNoteElement();
  const show = activeTool === 'note' || selectedNote !== null;
  if (notePanel) notePanel.style.display = show ? 'flex' : 'none';

  if (selectedNote && noteBgInput) {
    noteBgInput.value = selectedNote.backgroundColor;
  }
  if (selectedNote && noteTextColorInput) {
    noteTextColorInput.value = selectedNote.textColor;
  }
}

viewport.toolManager.onChange(updateNotePanel);
container.addEventListener('pointerup', () => requestAnimationFrame(updateNotePanel));
viewport.store.on('update', updateNotePanel);

noteBgInput?.addEventListener('input', () => {
  const color = noteBgInput.value;
  note.setOptions({ backgroundColor: color });
  const sel = getSelectedNoteElement();
  if (sel) viewport.store.update(sel.id, { backgroundColor: color });
});

noteTextColorInput?.addEventListener('input', () => {
  const color = noteTextColorInput.value;
  note.setOptions({ textColor: color });
  const sel = getSelectedNoteElement();
  if (sel) viewport.store.update(sel.id, { textColor: color });
});

const textPanel = document.getElementById('text-panel');
const fontSizeSelect = document.getElementById('font-size') as HTMLSelectElement | null;
const textColorInput = document.getElementById('text-color') as HTMLInputElement | null;
const alignButtons = document.querySelectorAll<HTMLButtonElement>('#text-panel [data-align]');

function getSelectedTextElement() {
  const ids = select.selectedIds;
  if (ids.length !== 1) return null;
  const el = viewport.store.getAll().find((e) => e.id === ids[0]);
  if (el && el.type === 'text') return el;
  return null;
}

function updateTextPanel() {
  const activeTool = viewport.toolManager.activeTool?.name;
  const selectedText = getSelectedTextElement();
  const show = activeTool === 'text' || selectedText !== null;
  if (textPanel) textPanel.style.display = show ? 'flex' : 'none';

  if (selectedText && fontSizeSelect) {
    fontSizeSelect.value = String(selectedText.fontSize);
  }
  if (selectedText && textColorInput) {
    textColorInput.value = selectedText.color;
  }
  if (selectedText) {
    alignButtons.forEach((b) =>
      b.classList.toggle('active', b.dataset['align'] === selectedText.textAlign),
    );
  }
}

viewport.toolManager.onChange(updateTextPanel);
container.addEventListener('pointerup', () => requestAnimationFrame(updateTextPanel));
viewport.store.on('update', updateTextPanel);

fontSizeSelect?.addEventListener('change', () => {
  const fontSize = Number(fontSizeSelect.value);
  text.setOptions({ fontSize });
  const sel = getSelectedTextElement();
  if (sel) viewport.store.update(sel.id, { fontSize });
});

alignButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const align = btn.dataset['align'] as 'left' | 'center' | 'right';
    text.setOptions({ textAlign: align });
    alignButtons.forEach((b) => b.classList.toggle('active', b === btn));
    const sel = getSelectedTextElement();
    if (sel) viewport.store.update(sel.id, { textAlign: align });
  });
});

textColorInput?.addEventListener('input', () => {
  const color = textColorInput.value;
  text.setOptions({ color });
  const sel = getSelectedTextElement();
  if (sel) viewport.store.update(sel.id, { color });
});

const colorInput = document.getElementById('tool-color') as HTMLInputElement | null;

colorInput?.addEventListener('input', (e) => {
  const color = (e.target as HTMLInputElement).value;
  pencil.setOptions({ color });
  arrow.setOptions({ color });
  note.setOptions({ backgroundColor: color });
  text.setOptions({ color });
  shape.setOptions({ strokeColor: color });
});

const shapePanel = document.getElementById('shape-panel');
const shapeKindSelect = document.getElementById('shape-kind') as HTMLSelectElement | null;
const shapeFillInput = document.getElementById('shape-fill') as HTMLInputElement | null;
const shapeNoFillBtn = document.getElementById('shape-no-fill') as HTMLButtonElement | null;

function updateShapePanel() {
  const activeTool = viewport.toolManager.activeTool?.name;
  if (shapePanel) shapePanel.style.display = activeTool === 'shape' ? 'flex' : 'none';
}

viewport.toolManager.onChange(updateShapePanel);

shapeKindSelect?.addEventListener('change', () => {
  shape.setOptions({ shape: shapeKindSelect.value as 'rectangle' | 'ellipse' });
});

shapeFillInput?.addEventListener('input', () => {
  shape.setOptions({ fillColor: shapeFillInput.value });
});

shapeNoFillBtn?.addEventListener('click', () => {
  shape.setOptions({ fillColor: 'none' });
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
    t: 'text',
    s: 'shape',
  };
  const tool = map[e.key];
  if (tool) {
    setActiveTool(tool);
  }
  if (e.key === 'g') {
    viewport.setSnapToGrid(!viewport.snapToGrid);
    if (snapBtn)
      snapBtn.innerHTML =
        (viewport.snapToGrid ? 'Snap: On' : 'Snap: Off') + '<span class="shortcut">G</span>';
  }
  if (e.key === 'i') {
    fileInput?.click();
  }
  if (e.key === 'l') {
    const panel = document.getElementById('layers-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
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

const snapBtn = document.getElementById('snap-toggle') as HTMLButtonElement | null;

snapBtn?.addEventListener('click', () => {
  viewport.setSnapToGrid(!viewport.snapToGrid);
  if (snapBtn)
    snapBtn.innerHTML =
      (viewport.snapToGrid ? 'Snap: On' : 'Snap: Off') + '<span class="shortcut">G</span>';
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

const layersList = document.getElementById('layers-list');

function renderLayersPanel() {
  if (!layersList) return;
  const layers = viewport.layerManager.getLayers().reverse();
  const activeId = viewport.layerManager.activeLayerId;

  layersList.innerHTML = '';
  for (const layer of layers) {
    const li = document.createElement('li');
    li.className = layer.id === activeId ? 'active' : '';

    const visBtn = document.createElement('button');
    visBtn.textContent = layer.visible ? '👁' : '🚫';
    visBtn.className = layer.visible ? 'on' : '';
    visBtn.title = layer.visible ? 'Hide layer' : 'Show layer';
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewport.layerManager.setLayerVisible(layer.id, !layer.visible);
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-name';
    nameSpan.textContent = layer.name;
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.value = layer.name;
      input.style.cssText =
        'width:100%;font-size:13px;border:1px solid #4a9eff;border-radius:3px;padding:1px 4px;';
      nameSpan.replaceWith(input);
      input.focus();
      input.select();
      const finish = () => {
        const newName = input.value.trim() || layer.name;
        viewport.layerManager.renameLayer(layer.id, newName);
      };
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') input.blur();
        if (ke.key === 'Escape') {
          input.value = layer.name;
          input.blur();
        }
      });
    });

    const lockBtn = document.createElement('button');
    lockBtn.textContent = layer.locked ? '🔒' : '🔓';
    lockBtn.className = layer.locked ? 'on' : '';
    lockBtn.title = layer.locked ? 'Unlock layer' : 'Lock layer';
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewport.layerManager.setLayerLocked(layer.id, !layer.locked);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete layer';
    deleteBtn.style.fontSize = '12px';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        viewport.layerManager.removeLayer(layer.id);
      } catch {
        // Can't remove last layer
      }
    });

    li.addEventListener('click', () => {
      viewport.layerManager.setActiveLayer(layer.id);
    });

    li.appendChild(visBtn);
    li.appendChild(nameSpan);
    li.appendChild(lockBtn);
    li.appendChild(deleteBtn);
    layersList.appendChild(li);
  }
}

viewport.layerManager.on('change', renderLayersPanel);
renderLayersPanel();

document.getElementById('add-layer')?.addEventListener('click', () => {
  viewport.layerManager.createLayer();
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
