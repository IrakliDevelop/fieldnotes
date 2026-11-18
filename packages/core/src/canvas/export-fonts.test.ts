import { describe, expect, it, vi } from 'vitest';
import { base64, fontFaceCss, loadFontFaces, selectFaces } from './export-fonts';

describe('SVG export fonts', () => {
  it('selectFaces keeps faces of the stack whose weight and style were used', () => {
    const faces = selectFaces(
      [
        { family: 'Inter', src: 'normal' },
        { family: 'Inter', weight: 'bold', src: 'bold' },
        { family: 'Inter', style: 'italic', src: 'italic' },
        { family: 'Roboto', src: 'roboto' },
      ],
      '"Inter", system-ui',
      new Set(['normal/normal', 'bold/normal']),
    );

    expect(faces.map((face) => face.src)).toEqual(['normal', 'bold']);
  });

  it('fontFaceCss escapes the family', () => {
    expect(fontFaceCss({ family: 'A"B', src: 'font' }, 'data:font/woff2;base64,AQID')).toContain(
      'font-family:"A\\"B"',
    );
  });

  it('uses only safe MIME types in quoted font data URLs', async () => {
    const css = await loadFontFaces(
      [{ family: 'Inter', src: new Blob([new Uint8Array([1])], { type: 'font/x)y' }) }],
      100,
    );

    expect(css).toEqual([
      '@font-face{font-family:"Inter";font-weight:normal;font-style:normal;src:url("data:application/octet-stream;base64,AQ==")}',
    ]);
    expect(css[0]).not.toContain('font/x)y');
  });

  it('infers a font MIME from a URL path when the response MIME is rejected', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'font/x)y' })),
    });
    vi.stubGlobal('fetch', fetch);

    try {
      expect(
        (
          await loadFontFaces(
            [{ family: 'Inter', src: 'https://fonts.test/inter.WOFF2?version=1#face' }],
            100,
          )
        )[0],
      ).toContain('src:url("data:font/woff2;base64,AQ==")');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('base64 encodes bytes without mid-string padding', () => {
    expect(base64(new Uint8Array(70_000).fill(0x41))).toBe('QUFB'.repeat(23_333) + 'QQ==');
  });
});
