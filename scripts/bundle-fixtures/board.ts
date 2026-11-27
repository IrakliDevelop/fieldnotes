import { HandTool, PencilTool, SelectTool, Viewport } from '@fieldnotes/core';

new Viewport(document.body, { tools: [new HandTool(), new SelectTool(), new PencilTool()] });
