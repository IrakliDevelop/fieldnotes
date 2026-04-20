// Stub document.execCommand and document.queryCommandState which are not
// implemented in jsdom but are needed for rich-text formatting tests.
if (typeof document !== 'undefined' && !('execCommand' in document)) {
  Object.defineProperty(document, 'execCommand', {
    value: (_command: string) => false,
    writable: true,
    configurable: true,
  });
}

if (typeof document !== 'undefined' && !('queryCommandState' in document)) {
  Object.defineProperty(document, 'queryCommandState', {
    value: (_command: string) => false,
    writable: true,
    configurable: true,
  });
}
