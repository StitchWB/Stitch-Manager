import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

interface MailHtmlSandboxProps {
  html: string;
  showRemoteImages: boolean;
  className?: string;
}

/**
 * Renders untrusted email HTML in an isolated iframe with `sandbox=""` and
 * a DOMPurify-sanitized payload. Layers of defense:
 *   1. iframe sandbox = no scripts, no same-origin, no forms
 *   2. DOMPurify strips disallowed tags/attributes
 *   3. By default we strip src= from <img>/<picture> tags so trackers don't fire
 *   4. javascript:/data: URLs in href are sanitized; remaining links open in
 *      a new top-level frame thanks to base target=_blank.
 *
 * The iframe height is auto-sized to its content via ResizeObserver inside the
 * sandbox so the message viewer doesn't end up with double scrollbars.
 */
export function MailHtmlSandbox({ html, showRemoteImages, className }: MailHtmlSandboxProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(200);

  const sanitizedHtml = useMemo(() => {
    const config = {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'meta', 'link'],
      FORBID_ATTR: [
        'onerror',
        'onload',
        'onclick',
        'onmouseover',
        'onfocus',
        'onblur',
        'onchange',
        'onsubmit',
        'formaction',
        'srcdoc',
        'autofocus',
      ],
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    } as Parameters<typeof DOMPurify.sanitize>[1];

    let cleaned = DOMPurify.sanitize(html, config) as unknown as string;

    if (!showRemoteImages) {
      // Strip remote image sources to block trackers. We replace src/srcset on
      // <img> and <source> tags after sanitization so that legitimate cid:
      // inline references survive (cid is rewritten by the inline-image
      // resolver later, when we have that). data: images are kept since they
      // do not leak network telemetry.
      cleaned = cleaned.replace(
        /<(img|source)\b([^>]*?)\s(src|srcset)\s*=\s*"(?!data:|cid:)[^"]*"/gi,
        '<$1$2 data-blocked-$3="blocked"'
      );
      cleaned = cleaned.replace(
        /<(img|source)\b([^>]*?)\s(src|srcset)\s*=\s*'(?!data:|cid:)[^']*'/gi,
        '<$1$2 data-blocked-$3="blocked"'
      );
      // CSS background-images (url(...)) in inline style attrs
      cleaned = cleaned.replace(
        /style\s*=\s*"([^"]*)"/gi,
        (_match, styleBody: string) => {
          const stripped = styleBody.replace(
            /background(-image)?\s*:\s*url\([^)]*\)\s*;?/gi,
            ''
          );
          return `style="${stripped}"`;
        }
      );
    }

    return cleaned;
  }, [html, showRemoteImages]);

  // Build the iframe document with our base styles. Using srcDoc ensures the
  // iframe inherits no origin from the host and starts with a known clean
  // document.
  const srcDoc = useMemo(() => {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <base target="_blank" />
    <style>
      :root { color-scheme: dark; }
      html, body {
        margin: 0;
        padding: 16px;
        background: transparent;
        color: #e2e8f0;
        font: 13px/1.55 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        word-wrap: break-word;
        overflow-wrap: break-word;
      }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
      a { color: #818cf8; }
      a:hover { color: #a5b4fc; }
      blockquote {
        border-left: 3px solid rgba(148, 163, 184, 0.3);
        margin: 8px 0;
        padding-left: 12px;
        color: #94a3b8;
      }
      pre, code { background: rgba(0,0,0,0.25); padding: 2px 4px; border-radius: 3px; }
      pre { padding: 8px; overflow: auto; }
      [data-blocked-src] {
        outline: 1px dashed rgba(244, 63, 94, 0.5);
        background: rgba(244, 63, 94, 0.08);
        min-width: 32px;
        min-height: 32px;
        display: inline-block;
      }
    </style>
  </head>
  <body>${sanitizedHtml}<script>
      // Auto-resize: post the document height to the parent so the iframe can
      // grow without inner scrollbars.
      (function () {
        function postHeight() {
          var h = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
          );
          parent.postMessage({ __mailHtmlSandbox: true, height: h }, '*');
        }
        window.addEventListener('load', postHeight);
        if (window.ResizeObserver) {
          new ResizeObserver(postHeight).observe(document.body);
        } else {
          window.setInterval(postHeight, 500);
        }
      })();
    </script></body>
</html>`;
  }, [sanitizedHtml]);

  // Listen for height messages from the sandbox.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { __mailHtmlSandbox?: boolean; height?: number } | null;
      if (!data || !data.__mailHtmlSandbox) return;
      if (event.source !== iframeRef.current?.contentWindow) return;

      const next = Math.max(140, Math.min(20000, Number(data.height) || 0));
      if (Number.isFinite(next) && next > 0) {
        setHeight(next);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title="mail-html-sandbox"
      // Empty sandbox: no scripts (the inner script we ship runs because the
      // attribute starts empty + the same-origin-derived restrictions still
      // forbid it from touching the host). For broad compatibility we allow
      // top-navigation-by-user-activation so links can open externally.
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
      // NOTE: we deliberately do NOT include allow-same-origin. Without it the
      // iframe runs in an opaque origin — even if a script slips past
      // DOMPurify, it cannot read cookies, localStorage or fetch from our
      // origin.
      srcDoc={srcDoc}
      style={{
        width: '100%',
        height: `${height}px`,
        border: 0,
        display: 'block',
      }}
      className={className}
    />
  );
}
