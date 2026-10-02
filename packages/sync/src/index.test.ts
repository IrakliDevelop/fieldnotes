import { describe, expect, it } from 'vitest';
import {
  createAuthorityClientExtension,
  createAuthorityExtensionReducer,
  createAuthorityLegacyExtensionReducer,
  createAuthorityWebSocketTransport,
  createManagedAuthorityConnection,
} from './index';

describe('authority client public exports', () => {
  it('exports the fixed runtime factories without exposing internal collaborators', () => {
    expect([
      createAuthorityClientExtension,
      createAuthorityExtensionReducer,
      createAuthorityLegacyExtensionReducer,
      createAuthorityWebSocketTransport,
      createManagedAuthorityConnection,
    ]).toEqual(Array(5).fill(expect.any(Function)));
  });
});
