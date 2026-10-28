import { describe, expect, it } from 'vitest';
import {
  createAuthorityClientExtension,
  createAuthorityExtensionReducer,
  createAuthorityLegacyExtensionReducer,
  createAuthorityWebSocketTransport,
  createManagedAuthorityConnection,
  ELEMENT_HIERARCHY_CAPABILITY_VERSION,
  LEGACY_SYNC_PROTOCOL_VERSION,
  SyncLimitError,
  supportsLegacyHierarchy,
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

describe('legacy hierarchy public exports', () => {
  it('exports the legacy protocol contract intentionally', () => {
    expect(LEGACY_SYNC_PROTOCOL_VERSION).toBe(3);
    expect(ELEMENT_HIERARCHY_CAPABILITY_VERSION).toBe(1);
    expect(supportsLegacyHierarchy).toEqual(expect.any(Function));
  });
});

describe('SyncLimitError export', () => {
  it('carries the element id and the limit name', () => {
    const error = new SyncLimitError('el-1', 'maxTextLength');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SyncLimitError');
    expect(error.elementId).toBe('el-1');
    expect(error.limit).toBe('maxTextLength');
  });
});
