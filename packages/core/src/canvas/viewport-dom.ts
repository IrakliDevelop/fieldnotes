export function createWrapper(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    overscrollBehavior: 'none',
    userSelect: 'none',
    webkitUserSelect: 'none',
  });
  return el;
}

export function createCanvas(): HTMLCanvasElement {
  const el = document.createElement('canvas');
  Object.assign(el.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
  });
  return el;
}

export function createDomLayer(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    transformOrigin: '0 0',
  });
  return el;
}
