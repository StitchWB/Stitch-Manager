import type { ReactNode } from 'react';

/**
 * Minimal safe Markdown → React renderer for the declarative `markdown`
 * node kind (additive v2 revision of the frozen vocabulary).
 *
 * SAFETY MODEL: the input is never parsed as HTML and never injected via
 * `dangerouslySetInnerHTML`. The text is split into blocks and inline
 * spans that map DIRECTLY to React elements; every literal fragment
 * becomes a React text node, which React escapes on render. Raw HTML in
 * the source (e.g. `<script>`) therefore shows up as inert visible text.
 * Links are restricted to http(s)/mailto URLs — any other scheme
 * (notably `javascript:`) renders its text without a hyperlink.
 *
 * Supported subset: headings (#..######), bold (**), italic (* and _),
 * inline code (`), fenced code blocks (```), links ([text](url)),
 * unordered lists (- or *), ordered lists (1. / 1)), paragraphs.
 * Anything else — including raw HTML — renders as plain text.
 */

/** Link schemes the markdown renderer turns into real hyperlinks. */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/**
 * Inline span tokenizer source: code, bold, italic (* / _), link.
 * Constructed per call below — a shared module-level /g regex would
 * corrupt `lastIndex` across the recursive renderInline calls.
 */
const INLINE_PATTERN_SOURCE =
  '(`([^`]+)`)|(\\*\\*([^*]+)\\*\\*)|(\\*([^*]+)\\*)|(_([^_]+)_)|(\\[([^\\]]*)\\]\\(([^)\\s]+)\\))';

/**
 * Render inline markdown spans to React nodes. Code spans take
 * precedence (no formatting inside backticks); bold/italic content is
 * rendered recursively (nesting-safe — each recursion consumes at least
 * the delimiter characters, so the input strictly shrinks); link text
 * renders as plain text and only safe-scheme URLs become hyperlinks.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const pattern = new RegExp(INLINE_PATTERN_SOURCE, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      out.push(text.slice(last, match.index));
    }
    const k = `${keyPrefix}-${key++}`;
    if (match[2] !== undefined) {
      // Inline code — content stays literal (no nested formatting).
      out.push(
        <code
          key={k}
          className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-xs text-indigo-300"
        >
          {match[2]}
        </code>,
      );
    } else if (match[4] !== undefined) {
      out.push(<strong key={k}>{renderInline(match[4], k)}</strong>);
    } else if (match[6] !== undefined) {
      out.push(<em key={k}>{renderInline(match[6], k)}</em>);
    } else if (match[8] !== undefined) {
      out.push(<em key={k}>{renderInline(match[8], k)}</em>);
    } else if (match[10] !== undefined) {
      const url = match[11];
      if (SAFE_LINK.test(url)) {
        out.push(
          <a
            key={k}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 underline hover:text-indigo-300"
          >
            {match[10]}
          </a>,
        );
      } else {
        // Unsafe scheme (javascript:, data:, ...): no hyperlink, keep
        // the visible text only.
        out.push(match[10]);
      }
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

const HEADING_CLASSES = [
  'text-xl font-semibold text-slate-100',
  'text-lg font-semibold text-slate-100',
  'text-base font-semibold text-slate-100',
  'text-sm font-semibold text-slate-100',
  'text-xs font-semibold text-slate-100',
  'text-xs font-semibold text-slate-300',
];

/** True when the line starts a new block (heading, fence, or list item). */
function startsBlock(line: string): boolean {
  return (
    /^#{1,6}\s+/.test(line) ||
    line.trim().startsWith('```') ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line)
  );
}

/**
 * Render a markdown string to a React element tree. Pure and side-effect
 * free; unknown syntax degrades to plain paragraph text.
 */
export function renderMarkdown(text: string): ReactNode {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank lines only separate blocks.
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block — content stays completely literal.
    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // Consume the closing fence (or run past the end unclosed).
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/40 p-3 font-mono text-xs text-slate-300"
        >
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(
        <Tag key={key++} className={HEADING_CLASSES[level - 1]}>
          {renderInline(heading[2], `h${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Unordered list — consecutive `- item` / `* item` lines.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list — consecutive `1. item` / `1) item` lines.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol${key}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph — consecutive plain lines joined into one block.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      buf.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <p key={key++} className="text-sm leading-relaxed text-slate-300">
        {renderInline(buf.join(' '), `p${key}`)}
      </p>,
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}
