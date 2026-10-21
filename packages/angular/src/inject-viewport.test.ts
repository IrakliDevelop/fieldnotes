import { afterEach, describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Viewport } from '@fieldnotes/core';
import { FIELDNOTES_VIEWPORT } from './context';
import { injectViewport } from './inject-viewport';
import { createTestViewport, destroyTestViewports } from './test-utils/create-test-viewport';

@Component({ selector: 'fn-test-consumer', template: '' })
class Consumer {
  readonly viewport = injectViewport();
}

afterEach(destroyTestViewports);

describe('injectViewport', () => {
  it('throws outside a provider', () => {
    expect(() => TestBed.createComponent(Consumer)).toThrow(
      'injectViewport must be used inside <fn-canvas>',
    );
  });

  it('returns the provided signal', () => {
    const provided = signal<Viewport | null>(null);
    TestBed.configureTestingModule({
      providers: [{ provide: FIELDNOTES_VIEWPORT, useValue: provided }],
    });
    const { viewport } = TestBed.createComponent(Consumer).componentInstance;
    expect(viewport).toBe(provided);
    expect(viewport()).toBeNull();

    const real = createTestViewport();
    provided.set(real);
    expect(viewport()).toBe(real);
  });
});
