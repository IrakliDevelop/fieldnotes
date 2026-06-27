import type { ArrowStrokeStyle, CanvasElement } from './types';

export interface ElementStyle {
  color?: string;
  fillColor?: string;
  strokeWidth?: number;
  opacity?: number;
  fontSize?: number;
  strokeStyle?: ArrowStrokeStyle;
}

export function styleToPatch(element: CanvasElement, style: ElementStyle): Partial<CanvasElement> {
  const { color, fillColor, strokeWidth, opacity, fontSize, strokeStyle } = style;
  switch (element.type) {
    case 'stroke':
      return {
        ...(color !== undefined ? { color } : {}),
        ...(strokeWidth !== undefined ? { width: strokeWidth } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
      };
    case 'arrow':
      return {
        ...(color !== undefined ? { color } : {}),
        ...(strokeWidth !== undefined ? { width: strokeWidth } : {}),
        ...(strokeStyle !== undefined ? { strokeStyle } : {}),
      };
    case 'shape':
      return {
        ...(color !== undefined ? { strokeColor: color } : {}),
        ...(fillColor !== undefined ? { fillColor } : {}),
        ...(strokeWidth !== undefined ? { strokeWidth } : {}),
      };
    case 'text':
      return {
        ...(color !== undefined ? { color } : {}),
        ...(fontSize !== undefined ? { fontSize } : {}),
      };
    case 'note':
      return {
        ...(color !== undefined ? { textColor: color } : {}),
        ...(fillColor !== undefined ? { backgroundColor: fillColor } : {}),
        ...(fontSize !== undefined ? { fontSize } : {}),
      };
    case 'grid':
      return {
        ...(color !== undefined ? { strokeColor: color } : {}),
        ...(strokeWidth !== undefined ? { strokeWidth } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
      };
    case 'template':
      return {
        ...(color !== undefined ? { strokeColor: color } : {}),
        ...(fillColor !== undefined ? { fillColor } : {}),
        ...(strokeWidth !== undefined ? { strokeWidth } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
      };
    default:
      return {};
  }
}

export function getElementStyle(element: CanvasElement): ElementStyle {
  switch (element.type) {
    case 'stroke':
      return { color: element.color, strokeWidth: element.width, opacity: element.opacity };
    case 'arrow':
      return {
        color: element.color,
        strokeWidth: element.width,
        ...(element.strokeStyle !== undefined ? { strokeStyle: element.strokeStyle } : {}),
      };
    case 'shape':
      return {
        color: element.strokeColor,
        fillColor: element.fillColor,
        strokeWidth: element.strokeWidth,
      };
    case 'text':
      return { color: element.color, fontSize: element.fontSize };
    case 'note':
      return {
        color: element.textColor,
        fillColor: element.backgroundColor,
        ...(element.fontSize !== undefined ? { fontSize: element.fontSize } : {}),
      };
    case 'grid':
      return {
        color: element.strokeColor,
        strokeWidth: element.strokeWidth,
        opacity: element.opacity,
      };
    case 'template':
      return {
        color: element.strokeColor,
        fillColor: element.fillColor,
        strokeWidth: element.strokeWidth,
        opacity: element.opacity,
      };
    default:
      return {};
  }
}
