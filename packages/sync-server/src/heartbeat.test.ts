import { describe, it, expect, vi, afterEach } from 'vitest';
import { startHeartbeat, type HeartbeatSocket, type HeartbeatServer } from './heartbeat';

class FakeSocket implements HeartbeatSocket {
  pinged = 0;
  terminated = false;
  private pongCb: (() => void) | undefined;
  ping(): void {
    this.pinged++;
  }
  terminate(): void {
    this.terminated = true;
  }
  on(_event: 'pong', listener: () => void): void {
    this.pongCb = listener;
  }
  pong(): void {
    this.pongCb?.();
  }
}

class FakeWss implements HeartbeatServer {
  clients = new Set<FakeSocket>();
}

describe('startHeartbeat', () => {
  afterEach(() => vi.useRealTimers());

  it('terminates a socket that never pongs after a full cycle', () => {
    vi.useFakeTimers();
    const wss = new FakeWss();
    const hb = startHeartbeat(wss, 1000);
    const s = new FakeSocket();
    wss.clients.add(s);
    hb.track(s);

    vi.advanceTimersByTime(1000);
    expect(s.pinged).toBe(1);
    expect(s.terminated).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(s.terminated).toBe(true);

    hb.stop();
  });

  it('keeps a socket that pongs each tick alive', () => {
    vi.useFakeTimers();
    const wss = new FakeWss();
    const hb = startHeartbeat(wss, 1000);
    const s = new FakeSocket();
    wss.clients.add(s);
    hb.track(s);

    vi.advanceTimersByTime(1000);
    expect(s.pinged).toBe(1);
    s.pong();

    vi.advanceTimersByTime(1000);
    expect(s.pinged).toBe(2);
    expect(s.terminated).toBe(false);
    s.pong();

    vi.advanceTimersByTime(1000);
    expect(s.terminated).toBe(false);

    hb.stop();
  });

  it('is disabled when intervalMs <= 0', () => {
    vi.useFakeTimers();
    const wss = new FakeWss();
    const hb = startHeartbeat(wss, 0);
    const s = new FakeSocket();
    wss.clients.add(s);
    hb.track(s);

    vi.advanceTimersByTime(100000);
    expect(s.pinged).toBe(0);
    expect(s.terminated).toBe(false);
    expect(() => hb.stop()).not.toThrow();
  });

  it('stop() clears the interval — no further pings', () => {
    vi.useFakeTimers();
    const wss = new FakeWss();
    const hb = startHeartbeat(wss, 1000);
    const s = new FakeSocket();
    wss.clients.add(s);
    hb.track(s);

    vi.advanceTimersByTime(1000);
    const before = s.pinged;
    hb.stop();
    vi.advanceTimersByTime(5000);
    expect(s.pinged).toBe(before);
  });
});
