# Extension API Example

A runnable demonstration of the Field Notes extension system. This example shows
how to build domain-specific features on top of `@fieldnotes/core` using its
public extension points.

## Patterns demonstrated

| File                                                     | Pattern                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/annotation-element.ts`](src/annotation-element.ts) | **Custom element type** — `ElementTypeDefinition` with validation, wrap/unwrap envelope conversion, bounds, hit-testing, canvas rendering, and SVG export |
| [`src/annotation-plugin.ts`](src/annotation-plugin.ts)   | **Viewport plugin** — `configure`/`start` lifecycle, element type registration, render hook registration, typed service via `ServiceKey`                  |
| [`src/annotation-tool.ts`](src/annotation-tool.ts)       | **Custom tool** — placing extension elements via `wrap()` and `store.add()`                                                                               |
| [`src/main.ts`](src/main.ts)                             | **Host wiring** — installing plugins at viewport construction, accessing services via `viewport.getService()`                                             |

## Run

```bash
cd examples/extension-api
pnpm install
pnpm dev
```

## Extension API quick reference

### Custom element type

```typescript
const myDefinition: ElementTypeDefinition<MyElement> = {
  type: 'my-ns:my-type',      // namespaced, globally unique
  legacyTypes: [],              // v3 wire type names (empty if none)
  validateData(data) { ... },   // called on deserialization
  wrap(el) { ... },             // typed → ExtensionElementEnvelope
  unwrap(el) { ... },           // ExtensionElementEnvelope → typed
  bounds(el) { ... },           // axis-aligned bounding box
  hitTest(el, point) { ... },   // point-in-element test
  render(ctx, el) { ... },      // canvas rendering
  emitSvg(el) { ... },          // SVG export
  decodeLegacy(raw) { ... },    // v3 wire → typed (for file migration)
};
```

### Viewport plugin

```typescript
const myPlugin: ViewportPlugin = {
  name: 'my-plugin',
  configure(ctx) {
    ctx.registerElementType(myDefinition);
    ctx.registerViewportHooks({ afterElements(ctx2d, elements, dims) { ... } });
    ctx.registerTool(myTool);
  },
  start(ctx) {
    ctx.registerService(MyServiceKey, { ... });
    ctx.store.on('add', (el) => { ... });
    return { dispose() { ... } };
  },
};

const viewport = new Viewport(el, { plugins: [myPlugin] });
```

### Typed service

```typescript
const MyKey = createServiceKey<MyInterface>('my-ns:my-service');
// In plugin start:
ctx.registerService(MyKey, { ... });
// In host app:
const svc = viewport.getService(MyKey);
```

## Further reading

- [`@fieldnotes/core` README](../../packages/core/README.md) — full API reference
- [`@fieldnotes/vtt`](../../packages/vtt/) — production-grade domain package built on these primitives
- [ADR-0001](../../docs/adr/0001-element-extensibility.md) — element extensibility design
- [ADR-0005](../../docs/adr/0005-plugin-lifecycle.md) — plugin lifecycle design
