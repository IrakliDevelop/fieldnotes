import { Viewport, SelectTool, HandTool } from '@fieldnotes/core';
import { SyncClient, WebSocketTransport } from '@fieldnotes/sync';
import { makeResolveAudience, type Role } from './policies';
import { TokenTool } from './token-tool';

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
  viewport.toolManager.register(new SelectTool());
  viewport.toolManager.register(new HandTool());
  viewport.toolManager.register(new TokenTool(color));
  viewport.setTool('select');

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
  $('place-token').addEventListener('click', () => viewport.setTool('token'));
  $('select').addEventListener('click', () => viewport.setTool('select'));

  // Task 4 wires cursors + the DM toolbar here, using: viewport, client, name, color, role, dmSecretLayerId.
  wireLiveFeatures({ viewport, client, name, color, role, dmSecretLayerId });
}

// Filled in Task 4.
function wireLiveFeatures(_ctx: {
  viewport: Viewport;
  client: SyncClient;
  name: string;
  color: string;
  role: Role;
  dmSecretLayerId: string | null;
}): void {}
