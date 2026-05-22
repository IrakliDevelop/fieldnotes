// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toggleBold,
  toggleItalic,
  toggleUnderline,
  toggleStrikethrough,
  setFontSize,
  getActiveFormats,
} from './note-formatting';

describe('note-formatting', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('toggle commands', () => {
    it('toggleBold calls execCommand with bold', () => {
      const spy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
      toggleBold();
      expect(spy).toHaveBeenCalledWith('bold');
    });

    it('toggleItalic calls execCommand with italic', () => {
      const spy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
      toggleItalic();
      expect(spy).toHaveBeenCalledWith('italic');
    });

    it('toggleUnderline calls execCommand with underline', () => {
      const spy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
      toggleUnderline();
      expect(spy).toHaveBeenCalledWith('underline');
    });

    it('toggleStrikethrough calls execCommand with strikeThrough', () => {
      const spy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
      toggleStrikethrough();
      expect(spy).toHaveBeenCalledWith('strikeThrough');
    });
  });

  describe('setFontSize', () => {
    it('does nothing when no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      expect(() => setFontSize(24)).not.toThrow();
    });

    it('does nothing when selection is collapsed', () => {
      const range = document.createRange();
      vi.spyOn(range, 'collapsed', 'get').mockReturnValue(true);
      const sel = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
      vi.spyOn(window, 'getSelection').mockReturnValue(sel);
      expect(() => setFontSize(24)).not.toThrow();
    });

    it('does nothing when rangeCount is 0', () => {
      const sel = { rangeCount: 0, getRangeAt: vi.fn() } as unknown as Selection;
      vi.spyOn(window, 'getSelection').mockReturnValue(sel);
      expect(() => setFontSize(24)).not.toThrow();
      expect(sel.getRangeAt).not.toHaveBeenCalled();
    });

    it('wraps selected text in a span with fontSize via surroundContents', () => {
      const container = document.createElement('div');
      container.textContent = 'Hello World';
      document.body.appendChild(container);

      const range = document.createRange();
      const textNode = container.firstChild;
      if (textNode) {
        range.setStart(textNode, 0);
        range.setEnd(textNode, 5);
      }

      vi.spyOn(window, 'getSelection').mockReturnValue({
        rangeCount: 1,
        getRangeAt: () => range,
      } as unknown as Selection);

      setFontSize(24);

      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span?.style.fontSize).toBe('24px');
      expect(span?.textContent).toBe('Hello');

      document.body.removeChild(container);
    });

    it('uses extractContents fallback when surroundContents throws', () => {
      const range = {
        collapsed: false,
        surroundContents: vi.fn().mockImplementation(() => {
          throw new Error('Cannot surroundContents');
        }),
        extractContents: vi.fn().mockReturnValue(document.createTextNode('extracted')),
        insertNode: vi.fn(),
      } as unknown as Range;

      vi.spyOn(window, 'getSelection').mockReturnValue({
        rangeCount: 1,
        getRangeAt: () => range,
      } as unknown as Selection);

      setFontSize(18);

      expect(range.extractContents).toHaveBeenCalled();
      expect(range.insertNode).toHaveBeenCalled();
      const insertedSpan = (range.insertNode as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | HTMLSpanElement
        | undefined;
      expect(insertedSpan?.style.fontSize).toBe('18px');
    });
  });

  describe('getActiveFormats', () => {
    it('returns all false when no formats active', () => {
      vi.spyOn(document, 'queryCommandState').mockReturnValue(false);
      const formats = getActiveFormats();
      expect(formats).toEqual({
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
      });
    });

    it('returns true for active formats', () => {
      vi.spyOn(document, 'queryCommandState').mockImplementation((cmd: string) => {
        return cmd === 'bold' || cmd === 'italic';
      });
      const formats = getActiveFormats();
      expect(formats.bold).toBe(true);
      expect(formats.italic).toBe(true);
      expect(formats.underline).toBe(false);
      expect(formats.strikethrough).toBe(false);
    });

    it('handles queryCommandState throwing', () => {
      vi.spyOn(document, 'queryCommandState').mockImplementation(() => {
        throw new Error('not supported');
      });
      const formats = getActiveFormats();
      expect(formats).toEqual({
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
      });
    });
  });
});
