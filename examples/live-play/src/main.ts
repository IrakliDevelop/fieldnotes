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
} from '@fieldnotes/core';
import type { Tool } from '@fieldnotes/core';
import { SyncClient, WebSocketTransport } from '@fieldnotes/sync';
import { makeResolveAudience, type Role } from './policies';
import { TokenTool } from './token-tool';
import { mountCursors } from './cursors';

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
  const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
  const role = ((form.elements.namedItem('role') as RadioNodeList).value as Role) || 'player';
  const room = (form.elements.namedItem('room') as HTMLInputElement).value.trim() || 'table';
  if (!name) return;
  start(name, role, room);
});

function start(name: string, role: Role, room: string): void {
  const color = colorFor(name);
  const viewport = new Viewport($('host'), { background: { pattern: 'dots' } });

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

  // BINDING ORDER: create the DM secret layer BEFORE the client so makeResolveAudience captures its id.
  const dmSecretLayerId: string | null =
    role === 'dm' ? viewport.layerManager.createLayer('DM Secret').id : null;

  const transport = new WebSocketTransport(
    `${RELAY}?name=${encodeURIComponent(name)}&role=${role}&room=${encodeURIComponent(room)}`,
  );
  transport.onClose((code) => {
    if (code === 4401) $('denied').textContent = 'Access denied — pick a unique name and rejoin.';
  });
  const client = new SyncClient({
    store: viewport.store,
    transport,
    clientId: name,
    resolveAudience: makeResolveAudience(dmSecretLayerId),
  });
  client.start();

  $('join').style.display = 'none';
  wireLiveFeatures({ viewport, client, name, color, role, dmSecretLayerId });
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
  name: string;
  color: string;
  role: Role;
  dmSecretLayerId: string | null;
}): void {
  const { viewport, client, name, color, role, dmSecretLayerId } = ctx;

  mountCursors($('host'), $('cursors'), viewport.camera, client, { name, color });

  if (role === 'dm' && dmSecretLayerId !== null) {
    const toolbar = $('dm-toolbar');
    toolbar.style.display = 'flex';
    // Map layer = the default layer (the one that is NOT "DM Secret").
    const mapLayerId = viewport.layerManager.getLayers().find((l) => l.name !== 'DM Secret')?.id;
    $('hide').addEventListener('click', () => {
      for (const id of viewport.getSelectedIds())
        viewport.layerManager.moveElementToLayer(id, dmSecretLayerId);
    });
    $('reveal').addEventListener('click', () => {
      if (!mapLayerId) return;
      for (const id of viewport.getSelectedIds())
        viewport.layerManager.moveElementToLayer(id, mapLayerId);
    });
  }
}
