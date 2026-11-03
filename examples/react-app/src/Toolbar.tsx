interface ToolbarProps {
  tool: string;
  onSelect: (name: string) => void;
  hasStamp: boolean;
}

const TOOL_LABELS: readonly (readonly [string, string])[] = [
  ['select', 'Select (V)'],
  ['hand', 'Hand (H)'],
  ['pencil', 'Pencil (P)'],
  ['eraser', 'Eraser (E)'],
  ['note', 'Note (N)'],
  ['shape', 'Shape (S)'],
  ['stamp', 'Stamp'],
];

export function Toolbar({ tool, onSelect, hasStamp }: ToolbarProps) {
  return (
    <div className="toolbar">
      {TOOL_LABELS.filter(([name]) => hasStamp || name !== 'stamp').map(([name, label]) => (
        <button key={name} className={tool === name ? 'active' : ''} onClick={() => onSelect(name)}>
          {label}
        </button>
      ))}
    </div>
  );
}
