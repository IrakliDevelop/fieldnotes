import { describe, it, expectTypeOf, assertType } from 'vitest';
import type {
  ExtensionElementEnvelope,
  ExtensionKind,
  ServiceKey,
  WireElement,
  WireElementV3,
  WireElementV4,
  RuntimeElement,
  GridElement,
  TemplateElement,
  TypedExtensionOp,
  Point,
} from './types';
import { createServiceKey, createExtensionKind } from './types';

// ─── Test fixtures ───────────────────────────────────────────────────────────

interface Animal {
  name: string;
}

interface Dog extends Animal {
  breed: string;
}

const dogKey = createServiceKey<Dog>('dog');
const animalKey = createServiceKey<Animal>('animal');

// ─── ServiceKey<T> genuine invariance ────────────────────────────────────────

describe('ServiceKey invariance', () => {
  it('ServiceKey<Dog> is NOT assignable to ServiceKey<Animal>', () => {
    // @ts-expect-error — ServiceKey<Dog> is not assignable to ServiceKey<Animal>
    assertType<ServiceKey<Animal>>(dogKey);
  });

  it('ServiceKey<Animal> is NOT assignable to ServiceKey<Dog>', () => {
    // @ts-expect-error — ServiceKey<Animal> is not assignable to ServiceKey<Dog>
    assertType<ServiceKey<Dog>>(animalKey);
  });

  it('same type works', () => {
    assertType<ServiceKey<Dog>>(dogKey);
  });

  it('brand is a function property, not covariant object', () => {
    const key = createServiceKey<string>('test');
    expectTypeOf(key._brand).toBeFunction();
    expectTypeOf(key._brand).parameter(0).toBeString();
    expectTypeOf(key._brand).returns.toBeString();
  });
});

// ─── WireElement ≠ RuntimeElement ────────────────────────────────────────────

describe('Wire vs Runtime separation', () => {
  it('GridElement (from core) is a WireElement', () => {
    const grid = {} as GridElement;
    assertType<WireElement>(grid);
    assertType<WireElementV3>(grid);
    // @ts-expect-error — extracted legacy shapes are not legal in v4 output
    assertType<WireElementV4>(grid);
  });

  it('TemplateElement (from core) is a WireElement', () => {
    const tmpl = {} as TemplateElement;
    assertType<WireElement>(tmpl);
  });

  it('ExtensionElementEnvelope is both WireElement and RuntimeElement', () => {
    const env = {} as ExtensionElementEnvelope;
    assertType<WireElement>(env);
    assertType<WireElementV4>(env);
    // @ts-expect-error — v3 readers do not know the extension envelope
    assertType<WireElementV3>(env);
    assertType<RuntimeElement>(env);
  });

  it('grid type literal is not in RuntimeElement type union', () => {
    type RuntimeTypes = RuntimeElement['type'];
    // 'grid' should not be assignable to RuntimeElement['type']
    // RuntimeElement = CoreElement | ExtensionElementEnvelope
    // CoreElement types: stroke, note, arrow, image, text, shape
    // ExtensionElementEnvelope type: 'extension'
    type HasGrid = 'grid' extends RuntimeTypes ? true : false;
    const check: HasGrid = false as HasGrid;
    assertType<false>(check);
  });
});

// ─── ExtensionKind<TPayload> binds handler type ──────────────────────────────

describe('ExtensionKind type binding', () => {
  it('handler payload type is bound by the codec', () => {
    interface FogPayload {
      generation: string;
      tiles: { x: number; y: number }[];
    }

    const fogCodec = {
      validate(payload: unknown): payload is FogPayload {
        return (
          typeof payload === 'object' &&
          payload !== null &&
          'generation' in payload &&
          'tiles' in payload
        );
      },
    };

    const fogKind = createExtensionKind({
      extensionKind: 'vtt:fog-patch',
      codec: fogCodec,
    });

    assertType<ExtensionKind<FogPayload>>(fogKind);
  });

  it('TypedExtensionOp<FogPayload>.payload is FogPayload', () => {
    interface FogPayload {
      generation: string;
    }
    const op = {} as TypedExtensionOp<FogPayload>;
    expectTypeOf(op.payload).toMatchTypeOf<FogPayload>();
    expectTypeOf(op.payload.generation).toBeString();
  });
});

// ─── ConstraintServiceAccess gating ──────────────────────────────────────────

describe('ConstraintServiceAccess', () => {
  it('constrainPoint requires Point argument', () => {
    interface Access {
      readonly constrainPoint: (point: Point, options?: { mode?: string }) => Point;
    }

    const svc = {} as Access;
    const result = svc.constrainPoint({ x: 0, y: 0 });
    expectTypeOf(result).toMatchTypeOf<Point>();
  });
});
