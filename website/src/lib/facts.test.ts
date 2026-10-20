import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFacts } from './facts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getFacts', () => {
  it('gives the landing four facts in A3 wording and the docs block with browsers, versions and gaps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ version: '9.9.9' })),
    );

    const facts = await getFacts();

    expect(facts.landing).toEqual([
      { term: 'Licence', detail: 'MIT. No licence key, no watermark.' },
      {
        term: 'Framework',
        detail: 'None needed. React, Vue and Svelte bindings if you want them.',
      },
      { term: 'Multiplayer', detail: 'Your own WebSocket relay, Redis optional.' },
      { term: 'Input', detail: 'Mouse, touch and pen with pressure.' },
    ]);
    expect(facts.docs.facts).toEqual([
      ...facts.landing,
      {
        term: 'Browsers',
        detail:
          'Tested in Chromium in CI, and in Firefox for embedded boards. Safari is expected to work and is not yet in CI.',
      },
    ]);
    expect(facts.docs.versions['@fieldnotes/sync-redis']).toEqual({
      version: '9.9.9',
      source: 'npm',
    });
    expect(facts.docs.notBuilt).toContain('Command palette');
    expect(facts.docs.notBuilt).toHaveLength(5);
  });
});
