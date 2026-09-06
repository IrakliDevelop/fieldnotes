import type {
  ApplyResult,
  BackendExtensionRegistry,
  ClientExtensionRegistry,
  ExtensionKind,
  ServerExtensionRegistry,
  TypedExtensionOp,
} from './types';

export class UnifiedExtensionRegistry {
  private readonly kinds = new Map<string, ExtensionKind<unknown>>();
  private readonly clientHandlers = new Map<
    string,
    (op: TypedExtensionOp<unknown>, meta: { sender: string }) => void
  >();
  private readonly serverHandlers = new Map<
    string,
    (op: TypedExtensionOp<unknown>, ctx: { room: string }) => Promise<ApplyResult>
  >();
  private readonly backendHandlers = new Map<
    string,
    (op: TypedExtensionOp<unknown>, ctx: { room: string }) => Promise<ApplyResult>
  >();

  registerKind<TPayload>(kind: ExtensionKind<TPayload>): void {
    this.kinds.set(kind.extensionKind, kind as ExtensionKind<unknown>);
  }

  getKind(extensionKind: string): ExtensionKind<unknown> | undefined {
    return this.kinds.get(extensionKind);
  }

  getClientRegistry(): ClientExtensionRegistry {
    return {
      register: <TPayload>(
        kind: ExtensionKind<TPayload>,
        handler: (op: TypedExtensionOp<TPayload>, meta: { sender: string }) => void,
      ) => {
        this.registerKind(kind);
        this.clientHandlers.set(
          kind.extensionKind,
          handler as (op: TypedExtensionOp<unknown>, meta: { sender: string }) => void,
        );
      },
    };
  }

  getServerRegistry(): ServerExtensionRegistry {
    return {
      register: <TPayload>(
        kind: ExtensionKind<TPayload>,
        handler: (op: TypedExtensionOp<TPayload>, ctx: { room: string }) => Promise<ApplyResult>,
      ) => {
        this.registerKind(kind);
        this.serverHandlers.set(
          kind.extensionKind,
          handler as (op: TypedExtensionOp<unknown>, ctx: { room: string }) => Promise<ApplyResult>,
        );
      },
    };
  }

  getBackendRegistry(): BackendExtensionRegistry {
    return {
      register: <TPayload>(
        kind: ExtensionKind<TPayload>,
        handler: (op: TypedExtensionOp<TPayload>, ctx: { room: string }) => Promise<ApplyResult>,
      ) => {
        this.registerKind(kind);
        this.backendHandlers.set(
          kind.extensionKind,
          handler as (op: TypedExtensionOp<unknown>, ctx: { room: string }) => Promise<ApplyResult>,
        );
      },
    };
  }

  dispatchClient(
    op: { extensionKind: string; payload: unknown },
    meta: { sender: string },
  ): boolean {
    const kind = this.kinds.get(op.extensionKind);
    if (!kind) return false;
    if (!kind.codec.validate(op.payload)) {
      throw new Error(`Codec validation failed for extension kind "${op.extensionKind}"`);
    }
    const handler = this.clientHandlers.get(op.extensionKind);
    if (!handler) return false;
    handler(op as TypedExtensionOp<unknown>, meta);
    return true;
  }

  async dispatchServer(
    op: { extensionKind: string; payload: unknown },
    ctx: { room: string },
  ): Promise<ApplyResult | null> {
    const kind = this.kinds.get(op.extensionKind);
    if (!kind) return null;
    if (!kind.codec.validate(op.payload)) {
      throw new Error(`Codec validation failed for extension kind "${op.extensionKind}"`);
    }
    const handler = this.serverHandlers.get(op.extensionKind);
    if (!handler) return null;
    return handler(op as TypedExtensionOp<unknown>, ctx);
  }

  getRegisteredKinds(): string[] {
    return [...this.kinds.keys()];
  }
}
