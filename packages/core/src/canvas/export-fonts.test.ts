import { describe, expect, it } from 'vitest';
import { base64, fontFaceCss, selectFaces } from './export-fonts';

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

  it('base64 encodes bytes without mid-string padding', () => {
    expect(base64(new Uint8Array(70_000).fill(0x41))).toBe('QUFB'.repeat(23_333) + 'QQ==');
  });
});
