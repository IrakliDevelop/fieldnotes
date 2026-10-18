import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportFailure } from './report-failure';

describe('reportFailure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes the error through reportError when it exists', () => {
    const reportSpy = vi.fn();
    vi.stubGlobal('reportError', reportSpy);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('boom');

    reportFailure(error, 'render failed');

    expect(reportSpy).toHaveBeenCalledWith(error);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('falls back to a labelled console.error when reportError is unavailable', () => {
    vi.stubGlobal('reportError', undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('boom');

    reportFailure(error, 'render failed');

    expect(errorSpy).toHaveBeenCalledWith('[fieldnotes] render failed', error);
  });
});
