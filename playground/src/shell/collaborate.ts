import { createRoom } from '../room';
import type { Room, SceneId } from '../scene';
import { icon } from './icons';
import type { IconName } from './icons';

function popoverButton(label: string, name: IconName, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-item';
  button.append(icon(name), label);
  button.addEventListener('click', run);
  return button;
}

/** Renders the Collaborate button and room popover into `root`; returns a function that re-reads the room. */
export function renderCollaborate(
  root: HTMLElement,
  opts: {
    room: () => Room | null;
    sceneId: () => SceneId | null;
    start: (room: Room) => void;
    leave: () => void;
    toast: (message: string) => void;
  },
): () => void {
  const wrapper = document.createElement('div');
  wrapper.className = 'collab';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'icon-button';
  toggle.dataset['collaborate'] = '';
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'collab-label';
  toggle.append(icon('users'), label);
  wrapper.append(toggle);
  root.append(wrapper);
  let popover: HTMLElement | null = null;

  const close = (): void => {
    if (!popover) return;
    popover.remove();
    popover = null;
    toggle.setAttribute('aria-expanded', 'false');
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pointerdown', onOutside);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };

  const onOutside = (event: PointerEvent): void => {
    if (event.target instanceof Node && wrapper.contains(event.target)) return;
    close();
  };

  const open = (room: Room): void => {
    const url = location.href;
    const el = document.createElement('div');
    el.className = 'island collab-popover';
    const title = document.createElement('p');
    title.className = 'collab-title';
    title.textContent = `Room ${room.id}`;
    const link = document.createElement('p');
    link.className = 'collab-link';
    link.textContent = url;
    const note = document.createElement('p');
    note.className = 'collab-note';
    note.textContent = 'Works between tabs of this browser.';
    el.append(
      title,
      link,
      popoverButton('Copy link', 'copy', () => {
        navigator.clipboard.writeText(url).then(
          () => opts.toast('Link copied'),
          () => opts.toast("Couldn't copy the link"),
        );
      }),
      popoverButton('Leave room', 'x', () => {
        close();
        opts.leave();
      }),
      note,
    );
    if (opts.sceneId() === 'tabletop') {
      const roles = document.createElement('p');
      roles.className = 'collab-note';
      roles.textContent = 'GM and player views are a local preview, not access control.';
      el.append(roles);
    }
    wrapper.append(el);
    popover = el;
    toggle.setAttribute('aria-expanded', 'true');
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onOutside);
  };

  toggle.addEventListener('click', () => {
    if (popover) {
      close();
      return;
    }
    let room = opts.room();
    if (!room) {
      room = createRoom();
      opts.start(room);
      window.open(location.href, '_blank', 'noopener');
    }
    open(room);
  });

  return () => {
    const room = opts.room();
    const text = room ? `Room ${room.id}` : 'Collaborate';
    label.textContent = text;
    // Phones hide the text label, so the name must not depend on it.
    toggle.setAttribute('aria-label', text);
    toggle.title = text;
    toggle.setAttribute('aria-pressed', String(room !== null));
  };
}
