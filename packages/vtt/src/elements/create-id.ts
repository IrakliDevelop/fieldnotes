let counter = 0;

function randomClientComponent(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2, 14);
}

const CLIENT = randomClientComponent();

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}_${CLIENT}`;
}
