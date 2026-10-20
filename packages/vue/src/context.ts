import type { InjectionKey } from 'vue';
import type { Viewport } from '@fieldnotes/core';

/** Injection key under which `<FieldNotesCanvas>` provides its Viewport; hosts may provide their own. */
export const ViewportKey: InjectionKey<Viewport> = Symbol('fieldnotes-viewport');
