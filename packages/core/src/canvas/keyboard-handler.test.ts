/**
 * @vitest-environment jsdom
 */
import { expect, it } from 'vitest';
import { KeyboardHandler } from './keyboard-handler';

it('exports KeyboardHandler for keyboard routing coverage', () => {
  expect(KeyboardHandler).toBeTypeOf('function');
});
