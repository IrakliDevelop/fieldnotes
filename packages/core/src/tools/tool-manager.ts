import type { Tool, ToolContext, PointerState } from './types';

export class ToolManager {
  private tools = new Map<string, Tool>();
  private current: Tool | null = null;
  private changeListeners = new Set<(name: string) => void>();
  private registerListeners = new Set<(tool: Tool) => void>();

  get activeTool(): Tool | null {
    return this.current;
  }

  get toolNames(): string[] {
    return [...this.tools.keys()];
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.registerListeners.forEach((fn) => fn(tool));
  }

  getTool<T extends Tool = Tool>(name: string): T | undefined {
    return this.tools.get(name) as T | undefined;
  }

  setTool(name: string, ctx: ToolContext): void {
    const tool = this.tools.get(name);
    if (!tool) return;

    this.current?.onDeactivate?.(ctx);
    this.current = tool;
    this.current.onActivate?.(ctx);
    this.changeListeners.forEach((fn) => fn(name));
  }

  handlePointerDown(state: PointerState, ctx: ToolContext): void {
    this.current?.onPointerDown(state, ctx);
  }

  handlePointerMove(state: PointerState, ctx: ToolContext): void {
    this.current?.onPointerMove(state, ctx);
  }

  handlePointerUp(state: PointerState, ctx: ToolContext): void {
    this.current?.onPointerUp(state, ctx);
  }

  onChange(listener: (name: string) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onRegister(listener: (tool: Tool) => void): () => void {
    this.registerListeners.add(listener);
    return () => this.registerListeners.delete(listener);
  }
}
