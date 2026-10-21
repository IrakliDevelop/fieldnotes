import { afterEach, describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectCamera } from './inject-camera';

afterEach(destroyTestViewports);

describe('injectCamera', () => {
  it('holds { x: 0, y: 0, zoom: 1 } before a viewport exists', async () => {
    const { result } = await mountHelper(() => injectCamera(), null);
    expect(result()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('returns the initial camera state', async () => {
    const { result } = await mountHelper(() => injectCamera());
    expect(result()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('updates when the camera pans and zooms', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectCamera(), viewport);
    viewport.camera.pan(100, 50);
    expect(result()).toEqual({ x: 100, y: 50, zoom: 1 });
    viewport.camera.setZoom(2);
    expect(result().zoom).toBe(2);
  });

  it('keeps the same reference when a change leaves the camera equal', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectCamera(), viewport);
    const before = result();
    viewport.camera.pan(0, 0);
    expect(result()).toBe(before);
  });

  it('stops updating once its component is destroyed', async () => {
    const viewport = createTestViewport();
    const { result, fixture } = await mountHelper(() => injectCamera(), viewport);
    fixture.destroy();
    viewport.camera.pan(100, 50);
    expect(result()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('reads the camera from a child inside <fn-canvas> after mount', async () => {
    @Component({ selector: 'fn-test-zoom', template: 'x={{ camera().x }}' })
    class Zoom {
      protected readonly camera = injectCamera();
    }
    @Component({
      selector: 'fn-test-host',
      imports: [FieldNotesCanvas, Zoom],
      template: '<fn-canvas (ready)="$event.camera.pan(42, 0)"><fn-test-zoom /></fn-canvas>',
    })
    class Host {}
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('fn-test-zoom').textContent).toBe('x=42');
  });
});
