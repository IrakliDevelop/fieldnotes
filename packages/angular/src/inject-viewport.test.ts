import { afterEach, describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { injectViewport } from './inject-viewport';
import { createTestViewport, destroyTestViewports } from './test-utils/create-test-viewport';
import { mountHelper } from './test-utils/mount-helper';

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

  it('returns the provided signal', async () => {
    const { result: viewport, provided } = await mountHelper(() => injectViewport(), null);
    expect(viewport).toBe(provided);
    expect(viewport()).toBeNull();

    const real = createTestViewport();
    provided.set(real);
    expect(viewport()).toBe(real);
  });
});
