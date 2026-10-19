import { h, isRecord } from './index';
import type { WidgetDef } from './index';

interface TextData {
  text: string;
}

const initialData = (): TextData => ({ text: 'Double-click, then Edit to write here.' });

function refresh(dom: HTMLElement, data: TextData): void {
  const view = dom.querySelector('.pg-text-view');
  const textarea = dom.querySelector('textarea');
  view?.replaceChildren(
    ...data.text.split(/\n+/).map((paragraph) => h('p', 'pg-text-paragraph', paragraph)),
  );
  if (textarea && textarea !== document.activeElement) textarea.value = data.text;
}

/** A text card shown as paragraphs and edited in a textarea. */
export const textCard: WidgetDef<TextData> = {
  htmlType: 'pg:text',
  label: 'Text card',
  icon: 'text-card',
  size: { w: 260, h: 180 },
  initialData,
  parse(data) {
    if (!isRecord(data) || typeof data['text'] !== 'string') return initialData();
    return { text: data['text'] };
  },
  render(data, commit) {
    const view = h('div', 'pg-text-view');
    const textarea = h('textarea', 'pg-widget-input pg-text-input');
    textarea.setAttribute('aria-label', 'Text');
    textarea.hidden = true;
    const edit = h('button', 'pg-widget-button', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      view.hidden = true;
      edit.hidden = true;
      textarea.hidden = false;
      textarea.focus();
    });
    // 'change' fires once per edit session (on blur), so a session is one undo step.
    textarea.addEventListener('change', () => {
      const text = textarea.value;
      commit(() => ({ text }));
    });
    textarea.addEventListener('blur', () => {
      textarea.hidden = true;
      view.hidden = false;
      edit.hidden = false;
    });
    const root = h('div', 'pg-widget pg-text');
    root.append(view, textarea, edit);
    refresh(root, data);
    return root;
  },
  refresh,
};
