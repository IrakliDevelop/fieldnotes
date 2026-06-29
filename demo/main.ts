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
  MeasureTool,
  TemplateTool,
  LaserTool,
  AutoSave,
  IndexedDBAdapter,
  createStroke,
  createNote,
  createGrid,
} from '@fieldnotes/core';
import type { AlignEdge, DistributeAxis } from '@fieldnotes/core';
import { SyncClient, BroadcastChannelTransport } from '@fieldnotes/sync';

console.log(`Field Notes v${VERSION}`);

const container = document.getElementById('canvas');
if (!container) throw new Error('Missing #canvas element');

const viewport = new Viewport(container, {
  background: { pattern: 'dots', spacing: 24, color: '#c0c0c0' },
  minimap: true,
  onImageError: ({ src }) => {
    console.warn('Image failed to load:', src);
    showToast('image-error-toast', 'Image failed to load');
  },
});

const benchParam = new URLSearchParams(location.search).get('bench');
const benchCount = benchParam ? Math.max(1, parseInt(benchParam, 10) || 500) : 0;

const hand = new HandTool();
const pencil = new PencilTool({ color: '#1a1a1a', width: 2 });
const highlighter = new PencilTool({
  name: 'highlighter',
  width: 12,
  opacity: 0.4,
  blendMode: 'multiply',
  color: '#ffeb3b',
});
const eraser = new EraserTool();
const select = new SelectTool();
const arrow = new ArrowTool({ color: '#1a1a1a', width: 2 });
const note = new NoteTool();
const text = new TextTool();
const shape = new ShapeTool({ strokeColor: '#1a1a1a' });
const measure = new MeasureTool();
const template = new TemplateTool();
const laser = new LaserTool();

viewport.toolManager.register(hand);
viewport.toolManager.register(pencil);
viewport.toolManager.register(highlighter);
viewport.toolManager.register(eraser);
viewport.toolManager.register(select);
viewport.toolManager.register(arrow);
viewport.toolManager.register(note);
viewport.toolManager.register(text);
viewport.toolManager.register(shape);
viewport.toolManager.register(measure);
viewport.toolManager.register(template);
viewport.toolManager.register(laser);

let autoSaveToastShown = false;

function showToast(id: string, message: string): void {
  if (document.getElementById(id)) return;
  const toast = document.createElement('div');
  toast.id = id;
  toast.className = 'demo-toast';
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.textContent = '✕';
  close.addEventListener('click', () => toast.remove());
  toast.append(text, close);
  (document.getElementById('toast-container') ?? document.body).appendChild(toast);
}

const autoSave = new AutoSave(viewport.store, viewport.camera, {
  layerManager: viewport.layerManager,
  adapter: new IndexedDBAdapter(),
  onError: (error) => {
    console.error('Auto-save failed', error);
    // toast shows once per page load; AutoSave has no success callback to reset on
    if (autoSaveToastShown) return;
    autoSaveToastShown = true;
    showToast('autosave-toast', 'Auto-save failed — storage may be full');
  },
});
if (!benchCount) {
  void (async () => {
    const savedState = await autoSave.load();
    if (savedState) {
      for (const el of savedState.elements) {
        if (el.type === 'html' && 'domId' in el && typeof el.domId === 'string') {
          if (!document.getElementById(el.domId)) {
            document.body.appendChild(createDemoWidget(el.domId));
          }
        }
      }
      viewport.loadState(savedState);
      console.log('Restored auto-saved state');
    }
    autoSave.start();
  })();
}

const emptyHint = document.getElementById('empty-hint');

function updateEmptyHint(): void {
  if (!emptyHint) return;
  emptyHint.style.display = viewport.store.getAll().length === 0 ? '' : 'none';
}

viewport.store.on('add', updateEmptyHint);
viewport.store.on('remove', updateEmptyHint);
updateEmptyHint();

viewport.setTool('select');

function syncToolButtons(name: string) {
  document.querySelectorAll<HTMLButtonElement>('#toolbar button').forEach((btn) => {
    const tool = btn.dataset['tool'];
    if (!tool) return;
    const isActive = tool === name;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function setActiveTool(name: string) {
  viewport.setTool(name);
  syncToolButtons(name);
}

viewport.toolManager.onChange((name) => {
  syncToolButtons(name);
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

let widgetCounter = 0;

function createDemoWidget(id: string): HTMLElement {
  const widget = document.createElement('div');
  widget.id = id;
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
  return widget;
}

document.getElementById('embed-btn')?.addEventListener('click', () => {
  const id = `demo-widget-${widgetCounter++}`;
  const widget = createDemoWidget(id);
  const rect = container.getBoundingClientRect();
  const center = viewport.camera.screenToWorld({
    x: rect.width / 2,
    y: rect.height / 2,
  });
  viewport.addHtmlElement(widget, { x: center.x - 100, y: center.y - 75 });
});

document.getElementById('insert-shape-btn')?.addEventListener('click', () => {
  viewport.addShape();
  setActiveTool('select');
});

const brushSlider = document.getElementById('brush-size') as HTMLInputElement | null;
const brushPreview = document.getElementById('brush-preview');
const brushLabel = document.getElementById('brush-label');

brushSlider?.addEventListener('input', () => {
  const width = Number(brushSlider.value);
  if (brushPreview) {
    const size = Math.max(4, width + 4);
    brushPreview.style.width = `${size}px`;
    brushPreview.style.height = `${size}px`;
  }
  if (brushLabel) brushLabel.textContent = `${width}px`;
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ strokeWidth: width });
  } else {
    pencil.setOptions({ width });
    arrow.setOptions({ width });
    shape.setOptions({ strokeWidth: width });
  }
});

const notePanel = document.getElementById('note-panel');
const noteBgInput = document.getElementById('note-bg') as HTMLInputElement | null;
const noteTextColorInput = document.getElementById('note-text-color') as HTMLInputElement | null;
const noteFontSizeSelect = document.getElementById('note-font-size') as HTMLSelectElement | null;

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
  if (selectedNote && noteFontSizeSelect) {
    noteFontSizeSelect.value = String(selectedNote.fontSize ?? 14);
  }
}

viewport.toolManager.onChange(updateNotePanel);
viewport.store.on('update', updateNotePanel);

noteBgInput?.addEventListener('input', () => {
  const color = noteBgInput.value;
  note.setOptions({ backgroundColor: color });
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ fillColor: color });
  }
});

noteTextColorInput?.addEventListener('input', () => {
  const color = noteTextColorInput.value;
  note.setOptions({ textColor: color });
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ color });
  }
});

noteFontSizeSelect?.addEventListener('change', () => {
  const fontSize = Number(noteFontSizeSelect.value);
  note.setOptions({ fontSize });
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ fontSize });
  }
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
viewport.store.on('update', updateTextPanel);

fontSizeSelect?.addEventListener('change', () => {
  const fontSize = Number(fontSizeSelect.value);
  text.setOptions({ fontSize });
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ fontSize });
  }
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
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ color });
  }
});

const colorInput = document.getElementById('tool-color') as HTMLInputElement | null;

colorInput?.addEventListener('input', (e) => {
  const color = (e.target as HTMLInputElement).value;
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ color });
  } else {
    pencil.setOptions({ color });
    arrow.setOptions({ color });
    note.setOptions({ backgroundColor: color });
    text.setOptions({ color });
    shape.setOptions({ strokeColor: color });
  }
});

const shapePanel = document.getElementById('shape-panel');
const shapeKindSelect = document.getElementById('shape-kind') as HTMLSelectElement | null;
const shapeStrokeColorInput = document.getElementById(
  'shape-stroke-color',
) as HTMLInputElement | null;
const shapeFillInput = document.getElementById('shape-fill') as HTMLInputElement | null;
const shapeNoFillBtn = document.getElementById('shape-no-fill') as HTMLButtonElement | null;

function getSelectedShapeElement() {
  const ids = viewport.getSelectedIds();
  if (ids.length !== 1) return null;
  const el = viewport.store.getAll().find((e) => e.id === ids[0]);
  if (el && el.type === 'shape') return el;
  return null;
}

function updateShapePanel() {
  const activeTool = viewport.toolManager.activeTool?.name;
  const selectedShape = getSelectedShapeElement();
  const show = activeTool === 'shape' || selectedShape !== null;
  if (shapePanel) shapePanel.style.display = show ? 'flex' : 'none';

  if (selectedShape && shapeStrokeColorInput) {
    shapeStrokeColorInput.value = selectedShape.strokeColor;
  }
  if (selectedShape && shapeFillInput) {
    shapeFillInput.value = selectedShape.fillColor === 'none' ? '#ffffff' : selectedShape.fillColor;
  }
}

viewport.toolManager.onChange(updateShapePanel);
viewport.store.on('update', updateShapePanel);

shapeKindSelect?.addEventListener('change', () => {
  shape.setOptions({ shape: shapeKindSelect.value as 'rectangle' | 'ellipse' | 'line' });
});

shapeStrokeColorInput?.addEventListener('input', () => {
  const color = shapeStrokeColorInput.value;
  shape.setOptions({ strokeColor: color });
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ color });
  }
});

shapeFillInput?.addEventListener('input', () => {
  const fillColor = shapeFillInput.value;
  shape.setOptions({ fillColor });
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ fillColor });
  }
});

shapeNoFillBtn?.addEventListener('click', () => {
  shape.setOptions({ fillColor: 'none' });
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ fillColor: 'none' });
  }
});

const arrowPanel = document.getElementById('arrow-panel');
const arrowStrokeStyleSelect = document.getElementById(
  'arrow-stroke-style',
) as HTMLSelectElement | null;

function getSelectedArrowElement() {
  const ids = viewport.getSelectedIds();
  if (ids.length !== 1) return null;
  const el = viewport.store.getAll().find((e) => e.id === ids[0]);
  if (el && el.type === 'arrow') return el;
  return null;
}

function updateArrowPanel() {
  const activeTool = viewport.toolManager.activeTool?.name;
  const selectedArrow = getSelectedArrowElement();
  const show = activeTool === 'arrow' || selectedArrow !== null;
  if (arrowPanel) arrowPanel.style.display = show ? 'flex' : 'none';

  if (arrowStrokeStyleSelect) {
    arrowStrokeStyleSelect.value =
      selectedArrow?.strokeStyle ?? arrow.getOptions().strokeStyle ?? 'solid';
  }
}

viewport.toolManager.onChange(updateArrowPanel);
viewport.store.on('update', updateArrowPanel);

arrowStrokeStyleSelect?.addEventListener('change', () => {
  const strokeStyle = arrowStrokeStyleSelect.value as 'solid' | 'dashed' | 'dotted';
  arrow.setOptions({ strokeStyle });
  if (viewport.getSelectionStyle() !== null) {
    viewport.applyStyleToSelection({ strokeStyle });
  }
});

function syncStyleControls() {
  const style = viewport.getSelectionStyle();
  if (style !== null) {
    if (colorInput && style.color !== undefined) colorInput.value = style.color;
    if (brushSlider && style.strokeWidth !== undefined) {
      brushSlider.value = String(style.strokeWidth);
      if (brushLabel) brushLabel.textContent = `${style.strokeWidth}px`;
      if (brushPreview) {
        const size = Math.max(4, style.strokeWidth + 4);
        brushPreview.style.width = `${size}px`;
        brushPreview.style.height = `${size}px`;
      }
    }
    if (fontSizeSelect && style.fontSize !== undefined) {
      fontSizeSelect.value = String(style.fontSize);
    }
  }
  // Panel visibility must update on every selection change, including deselect (style null).
  updateNotePanel();
  updateTextPanel();
  updateShapePanel();
  updateArrowPanel();
}

viewport.onSelectionChange(syncStyleControls);
viewport.store.on('update', syncStyleControls);

const alignPanel = document.getElementById('align-panel');
const distributeButtons = alignPanel?.querySelectorAll<HTMLButtonElement>('[data-distribute]');
const groupBtn = document.getElementById('group-btn') as HTMLButtonElement | null;
const ungroupBtn = document.getElementById('ungroup-btn') as HTMLButtonElement | null;
const lockBtn = document.getElementById('lock-btn') as HTMLButtonElement | null;

const zorderPanel = document.getElementById('zorder-panel');
const zMap: Record<string, string> = {
  'z-front-btn': 'z-front',
  'z-forward-btn': 'z-forward',
  'z-backward-btn': 'z-backward',
  'z-back-btn': 'z-back',
};
for (const [btnId, action] of Object.entries(zMap)) {
  document.getElementById(btnId)?.addEventListener('click', () => viewport.runAction(action));
}

function updateAlignPanel(): void {
  const ids = viewport.getSelectedIds();
  const n = ids.length;
  if (alignPanel) alignPanel.style.display = n >= 2 ? 'flex' : 'none';
  distributeButtons?.forEach((btn) => {
    btn.disabled = n < 3;
  });
  if (groupBtn) groupBtn.hidden = n < 2;
  if (ungroupBtn) {
    ungroupBtn.hidden = !ids.some((id) => viewport.store.getById(id)?.groupId);
  }
  if (lockBtn) {
    lockBtn.hidden = ids.length === 0;
    const allLocked = ids.length > 0 && ids.every((id) => viewport.store.getById(id)?.locked);
    lockBtn.textContent = allLocked ? 'Unlock' : 'Lock';
  }
  if (zorderPanel) zorderPanel.hidden = ids.length === 0;
}

groupBtn?.addEventListener('click', () => viewport.groupSelection());
ungroupBtn?.addEventListener('click', () => viewport.ungroupSelection());
lockBtn?.addEventListener('click', () => viewport.toggleLockSelection());

viewport.onSelectionChange(updateAlignPanel);
updateAlignPanel();

alignPanel?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  const align = btn.dataset['align'];
  const distribute = btn.dataset['distribute'];
  if (align) viewport.alignSelection(align as AlignEdge);
  else if (distribute) viewport.distributeSelection(distribute as DistributeAxis);
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
    m: 'measure',
  };
  const tool = map[e.key];
  if (tool) {
    setActiveTool(tool);
  }
  if (e.key === 'x') {
    viewport.setSnapToGrid(!viewport.snapToGrid);
    if (snapBtn)
      snapBtn.innerHTML =
        (viewport.snapToGrid ? 'Snap: On' : 'Snap: Off') + '<span class="shortcut">X</span>';
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

document.getElementById('fit-btn')?.addEventListener('click', () => viewport.fitToContent());

const snapBtn = document.getElementById('snap-toggle') as HTMLButtonElement | null;

snapBtn?.addEventListener('click', () => {
  viewport.setSnapToGrid(!viewport.snapToGrid);
  if (snapBtn)
    snapBtn.innerHTML =
      (viewport.snapToGrid ? 'Snap: On' : 'Snap: Off') + '<span class="shortcut">X</span>';
});

const guideBtn = document.getElementById('guide-toggle') as HTMLButtonElement | null;

guideBtn?.addEventListener('click', () => {
  viewport.setSmartGuides(!viewport.smartGuides);
  if (guideBtn) guideBtn.textContent = viewport.smartGuides ? 'Guides: On' : 'Guides: Off';
});

// Real-time sync (B1): open this demo in two tabs and toggle Sync in both to see live updates.
// Only toggle AFTER the autosave restore above has run — do NOT loadSnapshot while sync is
// active; that would broadcast the whole canvas. Snapshot-on-join lands in B2.
const syncBtn = document.getElementById('sync-toggle') as HTMLButtonElement | null;
let syncClient: SyncClient | null = null;
let syncTransport: BroadcastChannelTransport | null = null;

syncBtn?.addEventListener('click', () => {
  if (syncClient) {
    syncClient.stop();
    syncTransport?.close();
    syncClient = null;
    syncTransport = null;
    syncBtn.textContent = 'Sync: Off';
    syncBtn.setAttribute('aria-pressed', 'false');
    syncBtn.classList.remove('active');
  } else {
    syncTransport = new BroadcastChannelTransport('fieldnotes-demo-sync');
    syncClient = new SyncClient({ store: viewport.store, transport: syncTransport });
    syncClient.start();
    syncBtn.textContent = 'Sync: On';
    syncBtn.setAttribute('aria-pressed', 'true');
    syncBtn.classList.add('active');
  }
});

document.getElementById('save')?.addEventListener('click', () => {
  const json = viewport.exportJSON();
  console.log(`State snapshot (${json.length} bytes)`);
});

document.getElementById('load')?.addEventListener('click', async () => {
  const saved = await autoSave.load();
  if (!saved) {
    console.warn('No saved state found');
    return;
  }
  for (const el of saved.elements) {
    if (el.type === 'html' && 'domId' in el && typeof el.domId === 'string') {
      if (!document.getElementById(el.domId)) {
        document.body.appendChild(createDemoWidget(el.domId));
      }
    }
  }
  viewport.loadState(saved);
  syncGridPanelFromStore();
  console.log('State restored from auto-save');
});

const exportPaddingCheckbox = document.getElementById('export-padding') as HTMLInputElement | null;

document.getElementById('export-png')?.addEventListener('click', async () => {
  const padding = exportPaddingCheckbox?.checked ? 20 : 0;
  const bg = (document.getElementById('export-bg') as HTMLInputElement | null)?.value ?? '#ffffff';
  const scale = Number(
    (document.getElementById('export-scale') as HTMLSelectElement | null)?.value ?? 2,
  );
  const blob = await viewport.exportImage({ scale, padding, background: bg });
  if (!blob) {
    console.warn('Nothing to export');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'canvas-export.png';
  a.click();
  URL.revokeObjectURL(url);
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

// Template panel
const templatePanel = document.getElementById('template-panel');
const templateShapeSelect = document.getElementById('template-shape') as HTMLSelectElement | null;
const templateFeetInput = document.getElementById('template-feet') as HTMLInputElement | null;
const templateFillInput = document.getElementById('template-fill') as HTMLInputElement | null;
const templateNoFillBtn = document.getElementById('template-no-fill') as HTMLButtonElement | null;
const templateStrokeInput = document.getElementById('template-stroke') as HTMLInputElement | null;
const templateRenderStyleSelect = document.getElementById(
  'template-render-style',
) as HTMLSelectElement | null;

function updateTemplatePanel() {
  const activeTool = viewport.toolManager.activeTool?.name;
  if (templatePanel) templatePanel.style.display = activeTool === 'template' ? 'flex' : 'none';
}

viewport.toolManager.onChange(updateTemplatePanel);

templateShapeSelect?.addEventListener('change', () => {
  template.setOptions({
    templateShape: templateShapeSelect.value as 'circle' | 'cone' | 'line' | 'square',
  });
});

templateFillInput?.addEventListener('input', () => {
  const hex = templateFillInput.value;
  template.setOptions({ fillColor: hex + '33' });
});

templateNoFillBtn?.addEventListener('click', () => {
  template.setOptions({ fillColor: 'transparent' });
});

templateStrokeInput?.addEventListener('input', () => {
  template.setOptions({ strokeColor: templateStrokeInput.value });
});

templateFeetInput?.addEventListener('input', () => {
  const feet = Number(templateFeetInput.value);
  if (feet > 0) template.setOptions({ feetPerCell: feet });
});

templateRenderStyleSelect?.addEventListener('change', () => {
  template.setOptions({
    renderStyle: templateRenderStyleSelect.value as 'cells' | 'geometric',
  });
});

// Measure panel
const measurePanel = document.getElementById('measure-panel');
const measureFeetInput = document.getElementById('measure-feet') as HTMLInputElement | null;

function updateMeasurePanel() {
  const activeTool = viewport.toolManager.activeTool?.name;
  if (measurePanel) measurePanel.style.display = activeTool === 'measure' ? 'flex' : 'none';
}

viewport.toolManager.onChange(updateMeasurePanel);

measureFeetInput?.addEventListener('input', () => {
  const feet = Number(measureFeetInput.value);
  if (feet > 0) measure.setOptions({ feetPerCell: feet });
});

// Eraser panel
const eraserPanel = document.getElementById('eraser-panel');
const eraserModeSelect = document.getElementById('eraser-mode') as HTMLSelectElement | null;

function updateEraserPanel() {
  const activeTool = viewport.toolManager.activeTool?.name;
  if (eraserPanel) eraserPanel.style.display = activeTool === 'eraser' ? 'flex' : 'none';
}

viewport.toolManager.onChange(updateEraserPanel);

eraserModeSelect?.addEventListener('change', () => {
  eraser.setOptions({ mode: eraserModeSelect.value as 'partial' | 'stroke' });
});

const gridToggleBtn = document.getElementById('grid-toggle') as HTMLButtonElement | null;
const gridTypeSelect = document.getElementById('grid-type') as HTMLSelectElement | null;
const hexOrientationSelect = document.getElementById('hex-orientation') as HTMLSelectElement | null;
const gridCellSizeInput = document.getElementById('grid-cell-size') as HTMLInputElement | null;
const gridCellSizeLabel = document.getElementById('grid-cell-size-label');
const gridColorInput = document.getElementById('grid-color') as HTMLInputElement | null;

let gridActive = false;

function updateHexOrientationVisibility() {
  if (hexOrientationSelect) {
    hexOrientationSelect.style.display = gridTypeSelect?.value === 'hex' ? '' : 'none';
  }
}

updateHexOrientationVisibility();

function addOrUpdateGrid() {
  if (!gridActive) return;
  viewport.addGrid({
    gridType: (gridTypeSelect?.value as 'square' | 'hex') ?? 'hex',
    hexOrientation: (hexOrientationSelect?.value as 'pointy' | 'flat') ?? 'pointy',
    cellSize: Number(gridCellSizeInput?.value ?? 40),
    strokeColor: gridColorInput?.value ?? '#000000',
    strokeWidth: 1,
    opacity: 0.3,
  });
}

gridToggleBtn?.addEventListener('click', () => {
  gridActive = !gridActive;
  if (gridActive) {
    addOrUpdateGrid();
    gridToggleBtn.textContent = 'Grid: On';
    gridToggleBtn.classList.add('active');
  } else {
    viewport.removeGrid();
    gridToggleBtn.textContent = 'Grid: Off';
    gridToggleBtn.classList.remove('active');
  }
});

gridTypeSelect?.addEventListener('change', () => {
  updateHexOrientationVisibility();
  if (gridActive) addOrUpdateGrid();
});

hexOrientationSelect?.addEventListener('change', () => {
  if (gridActive) addOrUpdateGrid();
});

gridCellSizeInput?.addEventListener('input', () => {
  if (gridCellSizeLabel) gridCellSizeLabel.textContent = gridCellSizeInput.value;
  if (gridActive) {
    viewport.updateGrid({ cellSize: Number(gridCellSizeInput.value) });
  }
});

gridColorInput?.addEventListener('input', () => {
  if (gridActive) {
    viewport.updateGrid({ strokeColor: gridColorInput.value });
  }
});

function syncGridPanelFromStore() {
  const grid = viewport.store.getElementsByType('grid')[0];
  gridActive = !!grid;
  if (gridToggleBtn) {
    gridToggleBtn.textContent = gridActive ? 'Grid: On' : 'Grid: Off';
    if (gridActive) gridToggleBtn.classList.add('active');
    else gridToggleBtn.classList.remove('active');
  }
  if (grid && grid.type === 'grid') {
    if (gridTypeSelect) gridTypeSelect.value = grid.gridType;
    if (hexOrientationSelect) hexOrientationSelect.value = grid.hexOrientation;
    if (gridCellSizeInput) gridCellSizeInput.value = String(grid.cellSize);
    if (gridCellSizeLabel) gridCellSizeLabel.textContent = String(grid.cellSize);
    if (gridColorInput) gridColorInput.value = grid.strokeColor;
    updateHexOrientationVisibility();
  }
}

syncGridPanelFromStore();

viewport.logPerformance(2000);

const info = document.getElementById('info');
if (info) {
  const updateInfo = () => {
    const { x, y } = viewport.camera.position;
    const z = viewport.camera.zoom;
    const tool = viewport.toolManager.activeTool?.name ?? 'none';
    info.textContent = `${tool} · ${z.toFixed(2)}x · (${x.toFixed(0)}, ${y.toFixed(0)}) · Scroll=zoom · Middle/Space+drag=pan · Pinch=zoom · Shift+1=fit · V/H/P/E=tools`;
  };
  viewport.camera.onChange(updateInfo);
  viewport.toolManager.onChange(updateInfo);
  updateInfo();
  info.title = 'Click to reset zoom to 100%';
  info.addEventListener('click', () => {
    const rect = viewport.domLayer.getBoundingClientRect();
    viewport.camera.zoomAt(1, { x: rect.width / 2, y: rect.height / 2 });
  });
}

(window as unknown as Record<string, unknown>).__fieldnotes_viewport = viewport;
(window as unknown as { viewport: typeof viewport }).viewport = viewport;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedBench(count: number): void {
  const rand = mulberry32(42);
  const layerId = viewport.layerManager.activeLayerId;

  for (let i = 0; i < count; i++) {
    const points = [];
    let x = 0;
    let y = 0;
    const n = 10 + Math.floor(rand() * 30);
    for (let j = 0; j < n; j++) {
      x += (rand() - 0.5) * 60;
      y += (rand() - 0.5) * 60;
      points.push({ x, y, pressure: 0.3 + rand() * 0.6 });
    }
    viewport.store.add(
      createStroke({
        position: { x: rand() * 4000 - 500, y: rand() * 3000 - 500 },
        points,
        color: '#1565c0',
        width: 2 + rand() * 3,
        layerId,
      }),
    );
  }

  for (let i = 0; i < 10; i++) {
    viewport.store.add(
      createNote({
        position: { x: rand() * 4000 - 500, y: rand() * 3000 - 500 },
        size: { w: 160, h: 90 },
        text: `bench note ${i}`,
        layerId,
      }),
    );
  }

  viewport.store.add(
    createGrid({
      gridType: 'hex',
      hexOrientation: 'pointy',
      cellSize: 40,
      strokeColor: '#888888',
      strokeWidth: 1,
      opacity: 0.3,
      layerId,
    }),
  );

  viewport.fitToContent();
  console.log(`[bench] seeded ${count} strokes + 10 notes + 1 hex grid`);
  viewport.logPerformance();
}

if (benchCount) seedBench(benchCount);
