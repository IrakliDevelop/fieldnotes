import { createContext } from 'react';
import type { Viewport } from '@fieldnotes/core';

export const ViewportContext = createContext<Viewport | null>(null);
