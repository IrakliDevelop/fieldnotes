/** Shiki theme for code samples: keywords in red pencil, strings green, comments muted. */
export const codeTheme = {
  name: 'fieldnotes',
  type: 'light' as const,
  colors: {
    'editor.background': 'var(--code-bg)',
    'editor.foreground': 'var(--graphite)',
  },
  tokenColors: [
    { scope: ['keyword', 'storage'], settings: { foreground: 'var(--red)' } },
    // Operators such as `=` and `=>` stay graphite; only word operators like `new` are keywords.
    { scope: ['keyword.operator'], settings: { foreground: 'var(--graphite)' } },
    {
      scope: ['keyword.operator.new', 'keyword.operator.expression'],
      settings: { foreground: 'var(--red)' },
    },
    { scope: ['string'], settings: { foreground: 'var(--code-string)' } },
    { scope: ['comment'], settings: { foreground: 'var(--muted)' } },
  ],
};
