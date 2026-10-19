import type { AlignEdge, DistributeAxis, ElementStyle, Tool, Viewport } from '@fieldnotes/core';
import type { StyleControl, StyleSpec } from '../scene';
import { icon } from './icons';

type Value = string | number;
type ValueControl = Exclude<StyleControl, 'arrange'>;

interface ControlDef {
  readonly label: string;
  readonly style: keyof ElementStyle;
  /** Tool option the control sets, keyed by tool name. */
  readonly options: Readonly<Record<string, string>>;
  readonly choices: readonly { readonly label: string; readonly value: Value }[];
  readonly picker?: 'color' | 'range';
}

// Every tool named in CONTROLS[*].options has getOptions/setOptions.
interface ConfigurableTool extends Tool {
  getOptions(): Readonly<Record<string, unknown>>;
  setOptions(options: Readonly<Record<string, unknown>>): void;
}

const swatches = (colors: readonly string[]): ControlDef['choices'] =>
  colors.map((color) => ({ label: color, value: color }));

const CONTROLS: Record<ValueControl, ControlDef> = {
  'stroke-color': {
    label: 'Stroke',
    style: 'color',
    options: {
      pencil: 'color',
      highlighter: 'color',
      arrow: 'color',
      laser: 'color',
      shape: 'strokeColor',
      text: 'color',
      note: 'textColor',
    },
    choices: swatches(['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5']),
    picker: 'color',
  },
  'fill-color': {
    label: 'Fill',
    style: 'fillColor',
    options: { shape: 'fillColor', note: 'backgroundColor', template: 'fillColor' },
    choices: swatches(['none', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#eebefa']),
    picker: 'color',
  },
  'stroke-width': {
    label: 'Width',
    style: 'strokeWidth',
    options: { pencil: 'width', arrow: 'width', shape: 'strokeWidth' },
    choices: [
      { label: '2', value: 2 },
      { label: '4', value: 4 },
      { label: '8', value: 8 },
    ],
  },
  opacity: {
    label: 'Opacity',
    style: 'opacity',
    options: { pencil: 'opacity', highlighter: 'opacity' },
    choices: [],
    picker: 'range',
  },
  'font-size': {
    label: 'Font size',
    style: 'fontSize',
    options: { text: 'fontSize', note: 'fontSize' },
    choices: [
      { label: 'S', value: 14 },
      { label: 'M', value: 20 },
      { label: 'L', value: 32 },
    ],
  },
  'arrow-style': {
    label: 'Line',
    style: 'strokeStyle',
    options: { arrow: 'strokeStyle' },
    choices: [
      { label: 'Solid', value: 'solid' },
      { label: 'Dashed', value: 'dashed' },
      { label: 'Dotted', value: 'dotted' },
    ],
  },
};

const VALUE_CONTROLS: readonly ValueControl[] = [
  'stroke-color',
  'fill-color',
  'stroke-width',
  'opacity',
  'font-size',
  'arrow-style',
];

const ALIGN: readonly (readonly [string, AlignEdge])[] = [
  ['Left', 'left'],
  ['Center', 'center-x'],
  ['Right', 'right'],
  ['Top', 'top'],
  ['Middle', 'middle'],
  ['Bottom', 'bottom'],
];

const DISTRIBUTE: readonly (readonly [string, DistributeAxis])[] = [
  ['Space H', 'horizontal'],
  ['Space V', 'vertical'],
];

function group(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'style-control';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', label);
  const title = document.createElement('span');
  title.className = 'style-label';
  title.textContent = label;
  el.append(title);
  return el;
}

function button(label: string, run: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'icon-button';
  el.setAttribute('aria-label', label);
  el.title = label;
  // Keep focus on the canvas so core's undo/redo keys still apply after a click.
  el.addEventListener('mousedown', (event) => event.preventDefault());
  el.addEventListener('click', run);
  return el;
}

/** A control element and a function that shows `value` as its current state. */
interface Control {
  readonly el: HTMLElement;
  readonly show: (value: unknown) => void;
}

function control(def: ControlDef, current: unknown, apply: (value: Value) => void): Control {
  const el = group(def.label);
  const choiceButtons = new Map<HTMLButtonElement, Value>();
  const input = document.createElement('input');
  const show = (value: unknown): void => {
    for (const [entry, choice] of choiceButtons) {
      entry.setAttribute('aria-pressed', String(choice === value));
    }
    if (def.picker === 'range') {
      input.value = String(typeof value === 'number' ? Math.round(value * 100) : 100);
    } else if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
      input.value = value;
    }
  };
  const setValue = (value: Value): void => {
    apply(value);
    show(value);
  };
  for (const choice of def.choices) {
    const choiceButton = button(choice.label, () => setValue(choice.value));
    choiceButtons.set(choiceButton, choice.value);
    if (def.picker === 'color') {
      const swatch = document.createElement('span');
      swatch.className = choice.value === 'none' ? 'swatch swatch-none' : 'swatch';
      if (choice.value !== 'none') swatch.style.background = String(choice.value);
      choiceButton.append(swatch);
    } else {
      choiceButton.textContent = choice.label;
    }
    el.append(choiceButton);
  }
  if (def.picker) {
    input.type = def.picker;
    input.setAttribute('aria-label', `${def.label} ${def.picker === 'color' ? 'colour' : 'value'}`);
    if (def.picker === 'range') {
      input.min = '10';
      input.max = '100';
      input.step = '10';
      input.addEventListener('change', () => setValue(Number(input.value) / 100));
    } else {
      input.addEventListener('change', () => setValue(input.value));
    }
    el.append(input);
  }
  show(current);
  return { el, show };
}

function arrange(viewport: Viewport, count: number): HTMLElement {
  const el = group('Arrange');
  const add = (text: string, label: string, run: () => void): void => {
    const entry = button(label, run);
    entry.textContent = text;
    el.append(entry);
  };
  add('Front', 'Bring to front', () =>
    viewport.actions.run('arrange.bring-to-front', { source: 'api' }),
  );
  add('Back', 'Send to back', () =>
    viewport.actions.run('arrange.send-to-back', { source: 'api' }),
  );
  if (count >= 2) {
    for (const [text, edge] of ALIGN) {
      add(text, `Align ${text.toLowerCase()}`, () => viewport.alignSelection(edge));
    }
  }
  if (count >= 3) {
    for (const [text, axis] of DISTRIBUTE) {
      add(text, `Distribute ${axis}`, () => viewport.distributeSelection(axis));
    }
  }
  if (count >= 2) add('Group', 'Group', () => viewport.groupSelection());
  add('Ungroup', 'Ungroup', () => viewport.ungroupSelection());
  const remove = button('Delete', () => viewport.removeElements(viewport.getSelectedIds()));
  remove.append(icon('trash'));
  el.append(remove);
  return el;
}

/** Renders the style controls for the active tool (or the selection) into `root`; returns a cleanup. */
export function renderStylePanel(
  root: HTMLElement,
  viewport: Viewport,
  styles: StyleSpec,
): () => void {
  root.setAttribute('aria-label', 'Style');

  // Selection controls by style key, re-synced when undo/redo or a peer changes an element.
  let shown: (readonly [keyof ElementStyle, Control['show']])[] = [];
  let frame = 0;

  const render = (): void => {
    cancelAnimationFrame(frame);
    frame = 0;
    const toolName = viewport.toolManager.activeTool?.name ?? '';
    const children: HTMLElement[] = [];
    shown = [];
    if (toolName === 'select') {
      const ids = viewport.getSelectedIds();
      const details = viewport.getSelectionStyleDetails();
      if (ids.length > 0) {
        for (const name of VALUE_CONTROLS) {
          const def = CONTROLS[name];
          if (!details?.applicable.includes(def.style)) continue;
          const { el, show } = control(def, details.common[def.style], (value) =>
            viewport.applyStyleToSelection({ [def.style]: value }),
          );
          children.push(el);
          shown.push([def.style, show]);
        }
        children.push(arrange(viewport, ids.length));
      }
    } else {
      const tool = viewport.toolManager.getTool<ConfigurableTool>(toolName);
      for (const name of styles.controlsFor(toolName)) {
        if (name === 'arrange') continue;
        const def = CONTROLS[name];
        const key = def.options[toolName];
        if (!tool || key === undefined) continue;
        // Canvas ignores fillStyle 'none', so a template would keep the previous fill.
        const toOption = (value: Value): Value =>
          value === 'none' && toolName === 'template' ? 'transparent' : value;
        const current = tool.getOptions()[key];
        children.push(
          control(def, current === 'transparent' ? 'none' : current, (value) =>
            tool.setOptions({ [key]: toOption(value) }),
          ).el,
        );
      }
    }
    const extra = styles.extraSection?.(toolName);
    if (extra) children.push(extra);
    root.replaceChildren(...children);
    root.hidden = children.length === 0;
  };

  render();
  const offSelection = viewport.onSelectionChange(render);
  const offTool = viewport.toolManager.onChange(render);
  // A selection drag updates every selected element per move; resync once per frame.
  const offUpdate = viewport.store.on('update', () => {
    if (shown.length === 0 || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const common = viewport.getSelectionStyleDetails()?.common;
      for (const [style, show] of shown) show(common?.[style]);
    });
  });
  return () => {
    cancelAnimationFrame(frame);
    offSelection();
    offTool();
    offUpdate();
  };
}
