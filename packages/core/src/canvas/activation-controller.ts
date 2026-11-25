import { ElementActivation } from './element-activation';
import type {
  ActivationOptions,
  ElementActivationDeps,
  ElementActivationEvent,
} from './element-activation';

export class ActivationController {
  private activation: ElementActivation | null = null;
  private activationGeneration = 0;
  private readonly activationListeners = new Set<(e: ElementActivationEvent) => void>();

  constructor(private readonly deps: ElementActivationDeps) {}

  set(options: ActivationOptions | null): () => void {
    // Construct before tearing down: a RangeError must leave the current
    // controller — and every outstanding disposer's generation — intact.
    const next = options ? new ElementActivation(this.deps, options) : null;
    this.activation?.dispose();
    this.activation = next;
    next?.onActivate((e) => this.emitActivation(e));
    const generation = ++this.activationGeneration;
    return () => {
      if (this.activationGeneration !== generation) return;
      this.activation?.dispose();
      this.activation = null;
    };
  }

  onActivate(listener: (e: ElementActivationEvent) => void): () => void {
    this.activationListeners.add(listener);
    return () => {
      this.activationListeners.delete(listener);
    };
  }

  dispose(): void {
    this.activation?.dispose();
    this.activation = null;
    this.activationListeners.clear();
  }

  private emitActivation(event: ElementActivationEvent): void {
    for (const listener of [...this.activationListeners]) {
      try {
        listener(event);
      } catch {
        // One host listener's fault must not break its siblings.
      }
    }
  }
}
