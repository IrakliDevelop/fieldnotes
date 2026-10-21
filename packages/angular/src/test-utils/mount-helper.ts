import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Viewport } from '@fieldnotes/core';
import { FIELDNOTES_VIEWPORT } from '../context';
import { createTestViewport } from './create-test-viewport';

/** Runs `helper` in a component's injection context under a provided viewport signal. */
export async function mountHelper<T>(
  helper: () => T,
  viewport: Viewport | null = createTestViewport(),
) {
  const provided = signal(viewport);
  TestBed.configureTestingModule({
    providers: [{ provide: FIELDNOTES_VIEWPORT, useValue: provided }],
  });
  @Component({ selector: 'fn-test-consumer', template: '' })
  class Consumer {
    readonly result = helper();
  }
  const fixture = TestBed.createComponent(Consumer);
  await fixture.whenStable();
  return { result: fixture.componentInstance.result, provided, fixture };
}
