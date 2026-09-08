import type { Bounds } from '../core/types';
import type { ServiceKey } from '../core/service-key';
import type { PluginHandle } from '../core/plugin-state-manager';
import type { ElementTypeDefinition, BaseElement } from '../elements/types';
import type { ElementRegistry } from '../elements/element-registry';
import type { Tool } from '../tools/types';
import type { ToolManager } from '../tools/tool-manager';
import type {
  HookRegistrationOptions,
  ImageExportHooks,
  MinimapRenderHooks,
  SvgExportHooks,
  ViewportRenderHooks,
} from './render-hooks';
import type { ElementStore } from '../elements/element-store';
import type { Command } from '../history/types';
import type { Viewport } from './viewport';

export type RenderSurfaceName = 'viewport' | 'minimap' | 'imageExport' | 'svgExport';

export interface PluginConfigureContext {
  readonly elementRegistry: ElementRegistry;
  readonly toolManager: ToolManager;
  registerElementType<T extends BaseElement>(definition: ElementTypeDefinition<T>): void;
  registerTool(tool: Tool): void;
  registerViewportHooks(
    hooks: Partial<ViewportRenderHooks>,
    options?: HookRegistrationOptions,
  ): void;
  registerMinimapHooks(hooks: Partial<MinimapRenderHooks>, options?: HookRegistrationOptions): void;
  registerImageExportHooks(
    hooks: Partial<ImageExportHooks>,
    options?: HookRegistrationOptions,
  ): void;
  registerSvgExportHooks(hooks: Partial<SvgExportHooks>, options?: HookRegistrationOptions): void;
}

export interface PluginStartContext {
  readonly viewport: Viewport;
  readonly store: ElementStore;
  pushHistory(command: Command): void;
  requestRender(): void;
  invalidateMinimap(): void;
  registerService<T>(key: ServiceKey<T>, service: NoInfer<T>): void;
  addDisposer(dispose: () => void): void;
  registerExtraBounds(provider: () => Bounds | null): () => void;
  onChange(listener: () => void): () => void;
  notifyChange(): void;
}

export interface ViewportPlugin {
  readonly name: string;
  readonly priority?: number;
  readonly required?: boolean;
  configure?(context: PluginConfigureContext): void;
  start?(context: PluginStartContext): PluginHandle | undefined;
}

export type RequiredCapabilities =
  | readonly string[]
  | {
      readonly viewport?: readonly string[];
      readonly minimap?: readonly string[];
      readonly imageExport?: readonly string[];
      readonly svgExport?: readonly string[];
    };
