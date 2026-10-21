import { describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import type { Viewport } from '@fieldnotes/core';
import { bootstrapApplication } from '@angular/platform-browser';
import type { BootstrapContext } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { FIELDNOTES_VIEWPORT } from './context';
import { injectViewport } from './inject-viewport';

@Component({ selector: 'fn-test-child', template: 'viewport is null: {{ viewport() === null }}' })
class Child {
  protected readonly viewport = injectViewport();
}

@Component({
  selector: 'fn-test-root',
  imports: [Child],
  providers: [{ provide: FIELDNOTES_VIEWPORT, useValue: signal<Viewport | null>(null) }],
  template: '<fn-test-child />',
})
class Root {}

describe('server rendering', () => {
  it('renders a helper consumer with a null viewport', async () => {
    const html = await renderApplication(
      (context: BootstrapContext) =>
        bootstrapApplication(Root, { providers: [provideServerRendering()] }, context),
      { document: '<fn-test-root></fn-test-root>', url: '/' },
    );
    expect(html).toContain('viewport is null: true');
  });
});
