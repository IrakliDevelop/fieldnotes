import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, ErrorHandler, NgZone, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PencilTool, ShapeTool } from '@fieldnotes/core';
import type { ElementType, Viewport } from '@fieldnotes/core';
import { FIELDNOTES_VIEWPORT } from '../context';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { injectViewport } from '../inject-viewport';
import { countOpenListeners } from '../test-utils/count-listeners';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { injectActiveTool } from './inject-active-tool';
import { injectCamera } from './inject-camera';
import { injectElementRects } from './inject-element-rects';
import { injectElements } from './inject-elements';
import { injectHistory } from './inject-history';
import { injectLayers } from './inject-layers';
import { injectSelection } from './inject-selection';
import { injectSelectionOps } from './inject-selection-ops';
import { injectSelectionStyle } from './inject-selection-style';
import { injectSelectionStyleDetails } from './inject-selection-style-details';
import { injectToolOptions } from './inject-tool-options';

const toolName = signal('pencil');
const elementType = signal<ElementType | undefined>(undefined);

afterEach(() => {
  vi.restoreAllMocks();
  destroyTestViewports();
  toolName.set('pencil');
  elementType.set(undefined);
});

@Component({ selector: 'fn-test-consumer', template: '' })
class Consumer {
  constructor() {
    injectViewport();
    injectActiveTool();
    injectCamera();
    injectElementRects((el) => el.id);
    injectElements(elementType);
    injectElements((els) => els.length);
    injectHistory();
    injectLayers();
    injectSelection();
    injectSelectionOps();
    injectSelectionStyle();
    injectSelectionStyleDetails();
    injectToolOptions(toolName);
  }
}

describe('helper listener balance', () => {
  it('release every viewport listener when the whole canvas is destroyed', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const warn = vi.spyOn(console, 'warn');
    const handleError = vi.fn();
    TestBed.configureTestingModule({
      rethrowApplicationErrors: false,
      providers: [{ provide: ErrorHandler, useValue: { handleError } }],
    });
    const open = countOpenListeners();
    const baseline = open();
    @Component({
      selector: 'fn-test-host',
      imports: [FieldNotesCanvas, Consumer],
      template: '<fn-canvas><fn-test-consumer /></fn-canvas>',
    })
    class Host {}
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect(open()).toBeGreaterThan(baseline);

    expect(() => fixture.destroy()).not.toThrow();
    expect(open()).toBe(baseline);
    expect(handleError).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('release every listener when a consumer is destroyed after its inputs changed', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const viewport = createTestViewport();
    viewport.toolManager.register(new PencilTool());
    viewport.toolManager.register(new ShapeTool());
    const open = countOpenListeners();
    const baseline = open();
    TestBed.configureTestingModule({
      providers: [{ provide: FIELDNOTES_VIEWPORT, useValue: signal(viewport) }],
    });
    @Component({
      selector: 'fn-test-host',
      imports: [Consumer],
      template: '@if (shown()) { <fn-test-consumer /> }',
    })
    class Host {
      readonly shown = signal(true);
    }
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect(open()).toBeGreaterThan(baseline);

    toolName.set('shape');
    elementType.set('note');
    await fixture.whenStable();
    fixture.componentInstance.shown.set(false);
    await fixture.whenStable();

    expect(open()).toBe(baseline);
  });

  it.runIf('Zone' in globalThis)(
    'refreshes a child template when the camera pans outside the Angular zone',
    async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
      @Component({ selector: 'fn-test-pan', template: 'x={{ camera().x }}' })
      class Pan {
        protected readonly camera = injectCamera();
      }
      @Component({
        selector: 'fn-test-host',
        imports: [FieldNotesCanvas, Pan],
        template: '<fn-canvas (ready)="viewport = $event"><fn-test-pan /></fn-canvas>',
      })
      class Host {
        viewport: Viewport | null = null;
      }
      const fixture = TestBed.createComponent(Host);
      await fixture.whenStable();
      const text = () => fixture.nativeElement.querySelector('fn-test-pan').textContent;
      expect(text()).toBe('x=0');

      TestBed.inject(NgZone).runOutsideAngular(() =>
        fixture.componentInstance.viewport?.camera.pan(37, 0),
      );
      await fixture.whenStable();
      expect(text()).toBe('x=37');
    },
  );
});
