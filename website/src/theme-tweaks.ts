interface ThemeConfig {
  theme: string;
  accent: string;
  density: string;
}

const DEFAULTS: ThemeConfig = {
  theme: 'paper',
  accent: 'cyan',
  density: 'comfortable',
};

function apply(config: ThemeConfig): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', config.theme);
  root.setAttribute('data-accent', config.accent);
  root.setAttribute('data-density', config.density);

  document.querySelectorAll<HTMLElement>('.tweaks-panel [data-key]').forEach((group) => {
    const key = group.dataset['key'] as keyof ThemeConfig | undefined;
    if (!key) return;
    group.querySelectorAll<HTMLElement>('.tweak-opt').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset['val'] === config[key]);
    });
  });
}

export function initThemeTweaks(): void {
  const config = { ...DEFAULTS };
  apply(config);

  // Listen for host activation (Claude Design edit mode)
  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as { type?: string } | null;
    if (!data) return;
    const panel = document.getElementById('tweaks');
    if (data.type === '__activate_edit_mode') panel?.classList.add('on');
    if (data.type === '__deactivate_edit_mode') panel?.classList.remove('on');
  });

  // Click handlers for tweak buttons
  document.querySelectorAll<HTMLElement>('.tweaks-panel [data-key]').forEach((group) => {
    const key = group.dataset['key'] as keyof ThemeConfig | undefined;
    if (!key) return;

    group.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.tweak-opt');
      if (!btn) return;
      const val = btn.dataset['val'];
      if (!val) return;

      config[key] = val;
      apply(config);
    });
  });
}
