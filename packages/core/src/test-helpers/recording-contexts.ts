interface CanvasCall {
  name: string;
  args: unknown[];
  fillStyle: string;
}

/** Installs one call-recording 2D context for each canvas. */
export function installRecordingContexts(): {
  callsOf(canvas: HTMLCanvasElement): readonly CanvasCall[];
  restore(): void;
} {
  const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  const contexts = new Map<
    HTMLCanvasElement,
    { calls: CanvasCall[]; context: CanvasRenderingContext2D }
  >();

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement, type: string) {
      if (type !== '2d') return null;
      let entry = contexts.get(this);
      if (!entry) {
        const calls: CanvasCall[] = [];
        const state: Record<string, unknown> = { canvas: this, fillStyle: '#000000' };
        const context = new Proxy(state, {
          get(target, property) {
            const value = target[property as string];
            if (value !== undefined) return value;
            if (property === 'getImageData') {
              return (x: number, y: number, width: number, height: number) => {
                calls.push({
                  name: 'getImageData',
                  args: [x, y, width, height],
                  fillStyle: String(target.fillStyle),
                });
                return { data: new Uint8ClampedArray(width * height * 4) };
              };
            }
            return (...args: unknown[]) => {
              calls.push({ name: String(property), args, fillStyle: String(target.fillStyle) });
            };
          },
          set(target, property, value) {
            target[property as string] = value;
            return true;
          },
        }) as unknown as CanvasRenderingContext2D;
        entry = { calls, context };
        contexts.set(this, entry);
      }
      return entry.context;
    },
  });

  return {
    callsOf: (canvas) => contexts.get(canvas)?.calls ?? [],
    restore: () => {
      if (original) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', original);
    },
  };
}
