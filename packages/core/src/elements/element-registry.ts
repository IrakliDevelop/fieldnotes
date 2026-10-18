import type {
  BaseElement,
  ElementTypeAdapter,
  ElementTypeDefinition,
  ElementTypeKey,
} from './types';

export class ElementRegistry {
  private readonly definitions = new Map<string, ElementTypeDefinition<BaseElement>>();
  private readonly adapters = new Map<string, ElementTypeAdapter>();
  private readonly legacyIndex = new Map<string, ElementTypeAdapter>();

  /** Lookups fall back to `parent`; registration and removal touch only this registry. */
  constructor(private readonly parent?: ElementRegistry) {}

  register<T extends BaseElement>(def: ElementTypeDefinition<T>): ElementTypeKey<T> {
    if (this.definitions.has(def.type)) {
      throw new Error(`ElementType "${def.type}" is already registered`);
    }
    if (this.parent?.has(def.type)) {
      console.warn(
        `[fieldnotes] ElementType "${def.type}" shadows a type registered on the parent registry`,
      );
    }
    if (def.dataVersion !== undefined) {
      if (!Number.isSafeInteger(def.dataVersion) || def.dataVersion < 1) {
        throw new Error(`ElementType "${def.type}": dataVersion must be a positive integer`);
      }
      if (def.dataVersion > 1 && !def.migrate) {
        throw new Error(`ElementType "${def.type}": dataVersion above 1 requires migrate`);
      }
    }

    const erased = def as unknown as ElementTypeDefinition<BaseElement>;
    this.definitions.set(def.type, erased);
    const rewrapPreservingData = (
      original: Parameters<ElementTypeAdapter['unwrap']>[0],
      typed: T,
    ): ReturnType<ElementTypeAdapter['wrap']> => {
      const wrapped = def.wrap(typed);
      return { ...wrapped, data: { ...original.data, ...wrapped.data } };
    };

    const adapter: ElementTypeAdapter = {
      type: def.type,
      legacyTypes: def.legacyTypes,
      renderMode: def.renderMode ?? 'canvas',
      fullCanvas: def.fullCanvas ?? false,
      validateEnvelope: (el) => el.extensionType === def.type && def.validateData(el.data),
      decodeLegacy: (raw) => {
        const wrapped = def.wrap(def.decodeLegacy(raw));
        // Decoded legacy data is current; stamp it so no load path migrates it again.
        return def.dataVersion === undefined
          ? wrapped
          : { ...wrapped, dataVersion: def.dataVersion };
      },
      wrap: (el) => def.wrap(el as never),
      unwrap: (el) => def.unwrap(el),
      bounds: (el) => {
        const typed = def.unwrap(el);
        return def.bounds(typed);
      },
      hitTest: def.hitTest
        ? (el, point) => {
            const fn = def.hitTest;
            return fn ? fn(def.unwrap(el), point) : false;
          }
        : undefined,
      hitTestHandle: def.interaction?.hitTestHandle
        ? (el, point, context) => {
            const hitTestHandle = def.interaction?.hitTestHandle;
            return hitTestHandle ? hitTestHandle(def.unwrap(el), point, context) : null;
          }
        : undefined,
      updateHandle: def.interaction?.updateHandle
        ? (el, handleId, point, context) => {
            const updateHandle = def.interaction?.updateHandle;
            const typed = def.unwrap(el);
            return rewrapPreservingData(
              el,
              updateHandle ? updateHandle(typed, handleId, point, context) : typed,
            );
          }
        : undefined,
      renderSelection: def.interaction?.renderSelection
        ? (ctx, el, context) => {
            const renderSelection = def.interaction?.renderSelection;
            if (renderSelection) renderSelection(ctx, def.unwrap(el), context);
          }
        : undefined,
      rotate: def.interaction?.rotate
        ? (el, pivot, delta) => {
            const rotate = def.interaction?.rotate;
            const typed = def.unwrap(el);
            return rewrapPreservingData(el, rotate ? rotate(typed, pivot, delta) : typed);
          }
        : undefined,
      render: def.render
        ? (ctx, envelope, allElements, worldBounds) => {
            const fn = def.render;
            if (fn) fn(ctx, def.unwrap(envelope), allElements, worldBounds);
          }
        : undefined,
      emitSvg: def.emitSvg
        ? (envelope, allElements, viewBox) => {
            const fn = def.emitSvg;
            if (fn) return fn(def.unwrap(envelope), allElements, viewBox);
            return '';
          }
        : undefined,
      dataVersion: def.dataVersion,
      migrate: def.migrate?.bind(def),
      cloneRemap: def.cloneRemap
        ? (el, idMap) => {
            const fn = def.cloneRemap;
            // Base fields come from the clone; the def only owns the ids inside `data`.
            return fn ? { ...el, data: def.wrap(fn(def.unwrap(el), idMap)).data } : el;
          }
        : undefined,
    };

    this.adapters.set(def.type, adapter);
    for (const legacy of def.legacyTypes) {
      this.legacyIndex.set(legacy, adapter);
    }

    const key: ElementTypeKey<T> = {
      type: def.type,
      matches: (envelope) => envelope.extensionType === def.type && def.validateData(envelope.data),
      validateData: def.validateData,
      unwrap: (envelope) => {
        if (envelope.extensionType !== def.type) {
          throw new Error(
            `ElementTypeKey.unwrap: extensionType mismatch — expected "${def.type}", got "${envelope.extensionType}"`,
          );
        }
        if (!def.validateData(envelope.data)) {
          throw new Error(`ElementTypeKey.unwrap: data validation failed for "${def.type}"`);
        }
        return def.unwrap(envelope);
      },
      wrap: def.wrap,
    };

    return key;
  }

  unregister(type: string): void {
    const def = this.definitions.get(type);
    if (!def) return;
    this.definitions.delete(type);
    this.adapters.delete(type);
    for (const legacy of def.legacyTypes) {
      this.legacyIndex.delete(legacy);
    }
  }

  has(type: string): boolean {
    return this.adapters.has(type) || (this.parent?.has(type) ?? false);
  }

  getAdapter(type: string): ElementTypeAdapter | undefined {
    return this.adapters.get(type) ?? this.parent?.getAdapter(type);
  }

  getAdapterByLegacyType(legacyType: string): ElementTypeAdapter | undefined {
    return this.legacyIndex.get(legacyType) ?? this.parent?.getAdapterByLegacyType(legacyType);
  }

  getTypes(): string[] {
    const own = [...this.adapters.keys()];
    const inherited = this.parent?.getTypes().filter((type) => !this.adapters.has(type)) ?? [];
    return [...own, ...inherited];
  }
}
