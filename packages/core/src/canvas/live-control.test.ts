/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LIVE_NODE_ATTR, isLiveControlTarget, isTextEntryTarget } from './live-control';

describe('isLiveControlTarget', () => {
  let boundary: HTMLDivElement;

  function find(selector: string): Element {
    const el = boundary.querySelector(selector);
    if (!el) throw new Error(`missing ${selector}`);
    return el;
  }

  beforeEach(() => {
    boundary = document.createElement('div');
    boundary.innerHTML =
      '<div data-element-id="e1" data-fn-live><div class="pad"><span>t</span>' +
      '<button><b>x</b></button><button><i data-fn-drag>g</i></button>' +
      '<div data-fn-control>w</div><a>no href</a><a href="#">l</a></div></div>';
  });

  it('button descendant is a control', () => {
    expect(isLiveControlTarget(find('b'), boundary)).toBe(true);
  });

  it('data-fn-drag inside a control is padding', () => {
    expect(isLiveControlTarget(find('i'), boundary)).toBe(false);
  });

  it('control inside a data-fn-drag ancestor is a control', () => {
    find('.pad').insertAdjacentHTML(
      'beforeend',
      '<div data-fn-drag><button id="in"></button></div>',
    );
    expect(isLiveControlTarget(find('#in'), boundary)).toBe(true);
  });

  it('plain text and a[href]-less anchor are padding', () => {
    expect(isLiveControlTarget(find('span'), boundary)).toBe(false);
    expect(isLiveControlTarget(find('a:not([href])'), boundary)).toBe(false);
    expect(isLiveControlTarget(find('a[href]'), boundary)).toBe(true);
    expect(isLiveControlTarget(find('[data-fn-control]'), boundary)).toBe(true);
  });

  it('control in a node without data-fn-live is not live', () => {
    find('[data-element-id]').removeAttribute(LIVE_NODE_ATTR);
    expect(isLiveControlTarget(find('button'), boundary)).toBe(false);
  });

  it('target outside any element node is not a control', () => {
    const button = document.createElement('button');
    boundary.appendChild(button);
    expect(isLiveControlTarget(button, boundary)).toBe(false);
  });
});

describe('isTextEntryTarget', () => {
  it.each([
    ['<input type="text">', true],
    ['<textarea></textarea>', true],
    ['<div contenteditable><span>x</span></div>', true],
    ['<input type="checkbox">', false],
    ['<button></button>', false],
  ])('text-entry targets: %s → %s', (html, expected) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const target = host.querySelector('span') ?? host.firstElementChild;
    expect(isTextEntryTarget(target)).toBe(expected);
  });
});
