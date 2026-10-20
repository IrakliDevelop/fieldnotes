<script lang="ts">
  import {
    useActiveTool,
    useCamera,
    useElementRects,
    useElements,
    useHistory,
    useLayers,
    useSelection,
    useSelectionOps,
    useSelectionStyle,
    useSelectionStyleDetails,
    useToolOptions,
  } from '../index.js';

  const camera = useCamera();
  const elements = useElements();
  const count = useElements((els) => els.length);
  const selection = useSelection();
  const [tool] = useActiveTool();
  const [options] = useToolOptions('pencil');
  const [style] = useSelectionStyle();
  const [details] = useSelectionStyleDetails();
  const history = useHistory();
  const layers = useLayers();
  const ops = useSelectionOps();
  const rects = useElementRects((el) => el.id);
</script>

<span data-testid="camera">{$camera.x},{$camera.y},{$camera.zoom}</span>
<span data-testid="elements">{$elements.length}</span>
<span data-testid="count">{$count}</span>
<span data-testid="selection">{$selection.length}</span>
<span data-testid="tool">{$tool}</span>
<span data-testid="options">{$options?.color}</span>
<span data-testid="style">{$style?.color}</span>
<span data-testid="details">{$details?.common.color}</span>
<span data-testid="history">{$history.canUndo}</span>
<span data-testid="layers">{$layers.layers.length}</span>
<span data-testid="ops">{$ops.selectedCount}</span>
<span data-testid="rects">{$rects.length}</span>
