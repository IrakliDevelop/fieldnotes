import {
  Viewport,
  SelectTool,
  HandTool,
  PencilTool,
  ShapeTool,
  ArrowTool,
  NoteTool,
  TextTool,
  EraserTool,
  attachAwareness,
  defaultFeatures,
} from '@fieldnotes/core';
import type { Tool } from '@fieldnotes/core';
import { bearerSubprotocols, SyncClient, WebSocketTransport } from '@fieldnotes/sync';
import type { RemoteLayerUpdate } from '@fieldnotes/sync';
import {
  DEMO_TOKENS,
  DM_MAP_LAYER_ID,
  DM_SECRET_LAYER_ID,
  makeResolveAudience,
  type Role,
} from './policies';
import { TokenTool } from './token-tool';

const TOOL_LABELS: Record<string, string> = {
  select: 'Select',
  hand: 'Pan',
  pencil: 'Draw',
  shape: 'Shape',
  arrow: 'Arrow',
  note: 'Note',
  text: 'Text',
  eraser: 'Eraser',
  token: 'Token',
};

const RELAY = 'ws://localhost:8787';
const REMOTE = { origin: 'remote' };
const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed'];
const colorFor = (name: string) =>
  COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length] ?? '#3b82f6';

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const token = (form.elements.namedItem('token') as RadioNodeList).value;
  const room = (form.elements.namedItem('room') as HTMLInputElement).value.trim() || 'table';
  // Name and role here drive local UI only; the relay derives both from the token.
  const identity = DEMO_TOKENS[token];
  if (!identity) return;
  start(token, identity.name, identity.role, room);
});

function start(token: string, name: string, role: Role, room: string): void {
  const color = colorFor(name);
  const viewport = new Viewport($('host'), {
    background: { pattern: 'dots' },
    plugins: defaultFeatures(),
  });

  // The standard canvas tools (all sync live to peers) + the demo's owner-colored TokenTool.
  const palette: Tool[] = [
    new SelectTool(),
    new HandTool(),
    new PencilTool(),
    new ShapeTool(),
    new ArrowTool(),
    new NoteTool(),
    new TextTool(),
    new EraserTool(),
    new TokenTool(color),
  ];
  for (const tool of palette) viewport.toolManager.register(tool);
  viewport.setTool('select');
  buildToolbar(viewport, palette);

  const { layerManager, store } = viewport;
  if (role === 'dm') {
    const [starter] = layerManager.getLayers();
    const layer = { visible: true, locked: false, opacity: 1 };
    layerManager.addLayerDirect({ ...layer, id: DM_MAP_LAYER_ID, name: 'Map', order: 0 });
    layerManager.setActiveLayer(DM_MAP_LAYER_ID);
    if (starter) layerManager.removeLayerDirect(starter.id);
    layerManager.addLayerDirect({ ...layer, id: DM_SECRET_LAYER_ID, name: 'DM Secret', order: 1 });
  }

  // Remote layers apply without history; a player drops its empty starter layer once the DM's arrive.
  let adopted = role === 'dm';
  const applyLayer = ({ record }: RemoteLayerUpdate): void => {
    const { id, definition } = record;
    if (!definition) {
      layerManager.removeLayerDirect(id, REMOTE);
      const [fallback] = layerManager.getLayers();
      if (fallback && layerManager.activeLayerId === id) layerManager.setActiveLayer(fallback.id);
      return;
    }
    const own = adopted ? [] : layerManager.getLayers();
    adopted = true;
    if (layerManager.getLayer(id)) layerManager.updateLayerDirect(id, definition, REMOTE);
    else layerManager.addLayerDirect(definition, REMOTE);
    const [starter] = own;
    if (
      own.length !== 1 ||
      !starter ||
      starter.id === id ||
      store.getAll().some((el) => el.layerId === starter.id)
    ) {
      return;
    }
    layerManager.removeLayerDirect(starter.id, REMOTE);
    layerManager.setActiveLayer(id);
  };

  const transport = new WebSocketTransport(`${RELAY}?room=${encodeURIComponent(room)}`, {
    protocols: bearerSubprotocols(token),
  });
  transport.onClose((code) => {
    if (code === 4401) $('denied').textContent = 'Access denied. Pick a demo identity and rejoin.';
    if (code === 4400) {
      $('denied').textContent = 'Invalid room — use letters, numbers, underscores, or hyphens.';
    }
  });
  const client = new SyncClient({
    store: viewport.store,
    transport,
    clientId: name,
    // A local-rendering hint only: the relay decides every audience.
    resolveAudience: makeResolveAudience(DM_SECRET_LAYER_ID),
    layers: { applyLayer },
  });
  layerManager.on('create', (layer, meta) => {
    if (meta.origin !== REMOTE.origin) client.publishLayerUpsert(layer);
  });
  layerManager.on('update', ({ current }, meta) => {
    if (meta.origin !== REMOTE.origin) client.publishLayerUpsert(current);
  });
  layerManager.on('remove', (layer, meta) => {
    if (meta.origin !== REMOTE.origin) client.publishLayerRemove(layer.id);
  });
  client.start();
  if (role === 'dm') for (const layer of layerManager.getLayers()) client.publishLayerUpsert(layer);

  $('join').style.display = 'none';
  wireLiveFeatures({ viewport, client, transport, name, color, role });
}

// Build the tool palette + undo/redo, and highlight the active tool (also when it changes via keyboard).
function buildToolbar(viewport: Viewport, palette: Tool[]): void {
  const bar = $('tools');
  bar.textContent = '';
  const buttons = new Map<string, HTMLButtonElement>();
  for (const tool of palette) {
    const b = document.createElement('button');
    b.textContent = TOOL_LABELS[tool.name] ?? tool.name;
    b.addEventListener('click', () => viewport.setTool(tool.name));
    bar.appendChild(b);
    buttons.set(tool.name, b);
  }

  const sep = document.createElement('div');
  sep.className = 'sep';
  bar.appendChild(sep);
  const undo = document.createElement('button');
  undo.textContent = '↶ Undo';
  undo.addEventListener('click', () => viewport.undo());
  const redo = document.createElement('button');
  redo.textContent = 'Redo ↷';
  redo.addEventListener('click', () => viewport.redo());
  bar.append(undo, redo);

  const highlight = (name: string) => {
    for (const [n, b] of buttons) b.classList.toggle('active', n === name);
  };
  viewport.toolManager.onChange(highlight);
  highlight(viewport.toolManager.activeTool?.name ?? 'select');
}

function wireLiveFeatures(ctx: {
  viewport: Viewport;
  client: SyncClient;
  transport: WebSocketTransport;
  name: string;
  color: string;
  role: Role;
}): void {
  const { viewport, client, transport, name, color, role } = ctx;

  const awareness = attachAwareness(viewport, client, {
    identity: { id: name, name, color, role },
    fields: { cursor: true, selection: false, tool: true },
  });
  awareness.announce();
  transport.onReconnect(() => awareness.announce());

  const peers = $('peers');
  const renderPeers = () => {
    peers.textContent = '';
    for (const peer of awareness.roster.getPeers()) {
      const chip = document.createElement('span');
      chip.className = 'peer';
      chip.style.setProperty('--c', awareness.cursors?.resolveColor(peer) ?? '#3b82f6');
      chip.textContent = `${peer.name ?? peer.id}${peer.tool ? ` · ${peer.tool}` : ''}`;
      peers.appendChild(chip);
    }
  };
  awareness.roster.onChange(renderPeers);
  renderPeers();

  if (role === 'dm') {
    const toolbar = $('dm-toolbar');
    toolbar.style.display = 'flex';
    $('hide').addEventListener('click', () => {
      for (const id of viewport.getSelectedIds())
        viewport.layerManager.moveElementToLayer(id, DM_SECRET_LAYER_ID);
    });
    $('reveal').addEventListener('click', () => {
      for (const id of viewport.getSelectedIds())
        viewport.layerManager.moveElementToLayer(id, DM_MAP_LAYER_ID);
    });
  }
}
