import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('live-play room input', () => {
  it('uses a valid browser pattern that matches the relay room contract', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const roomInput = html.match(/<input\s+name="room"[\s\S]*?>/)?.[0];
    const pattern = roomInput?.match(/pattern="([^"]+)"/)?.[1];

    expect(pattern).toBeDefined();
    const browserPattern = new RegExp(`^(?:${pattern})$`, 'v');
    expect(browserPattern.test('Room_1-safe')).toBe(true);
    expect(browserPattern.test('room:unsafe')).toBe(false);
    expect(browserPattern.test('x'.repeat(65))).toBe(false);
  });
});
