import { describe, it, expect } from 'vitest';
import { InMemoryHubFanout } from './hub-fanout';

describe('InMemoryHubFanout', () => {
  it('delivers a published payload to all subscribed handlers', () => {
    const bus = new InMemoryHubFanout();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((p) => a.push(p));
    bus.subscribe((p) => b.push(p));

    bus.publish('hello');

    expect(a).toEqual(['hello']);
    expect(b).toEqual(['hello']);
  });

  it('stops delivery after unsubscribe', () => {
    const bus = new InMemoryHubFanout();
    const got: string[] = [];
    const unsub = bus.subscribe((p) => got.push(p));

    bus.publish('one');
    unsub();
    bus.publish('two');

    expect(got).toEqual(['one']);
  });

  it('a throwing handler does not stop delivery to the others', () => {
    const bus = new InMemoryHubFanout();
    const got: string[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((p) => got.push(p));

    bus.publish('payload');

    expect(got).toEqual(['payload']);
  });
});
