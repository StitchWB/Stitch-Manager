import { memo, useMemo, useState, useCallback } from 'react';
import { User, Bot, Copy, Pencil, RefreshCw, Trash2, Check } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '../../stores/chat';
import type { ContentBlock } from '../../types/generated';
import { t } from '@/lib/i18n';
import { ButtonBase, LoadingSpinner } from '@/components/ui';

interface ChatMessageProps {
  message: ChatMessageType;
  onCopy?: (id: string) => void;
  onEdit?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
}

/**
 * Enhanced markdown parser for chat messages.
 * Supports: bold, italic, inline code, code blocks, headers, links, and lists.
 */
function parseMarkdown(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let key = 0;

  // Split by code blocks first
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  const processInlineText = (text: string): React.ReactNode[] => {
    const inlineElements: React.ReactNode[] = [];
    let inlineKey = 0;

    // Process inline elements: bold+italic, bold, italic, inline code, links
    const parts = text.split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[([^\]]+)\]\(([^)]+)\))/g);

    for (const part of parts) {
      if (!part) continue;

      // Bold + italic
      if (part.startsWith('***') && part.endsWith('***')) {
        inlineElements.push(
          <strong key={`bi-${inlineKey++}`} className="font-semibold italic text-vsc-text">
            {part.slice(3, -3)}
          </strong>
        );
      }
      // Bold text
      else if (part.startsWith('**') && part.endsWith('**')) {
        inlineElements.push(
          <strong key={`bold-${inlineKey++}`} className="font-semibold text-vsc-text">
            {part.slice(2, -2)}
          </strong>
        );
      }
      // Italic text
      else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
        inlineElements.push(
          <em key={`italic-${inlineKey++}`} className="italic text-vsc-text">
            {part.slice(1, -1)}
          </em>
        );
      }
      // Inline code
      else if (part.startsWith('`') && part.endsWith('`')) {
        inlineElements.push(
          <code
            key={`code-${inlineKey++}`}
            className="px-1.5 py-0.5 bg-vsc-input rounded text-vsc-green font-mono text-xs"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      // Regular text - check for headers, lists, and links
      else {
        const lines = part.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // H3
          if (line.match(/^###\s/)) {
            inlineElements.push(
              <div key={`h3-${inlineKey++}`} className="text-sm font-semibold text-vsc-text mt-2 mb-1">
                {line.replace(/^###\s/, '')}
              </div>
            );
          }
          // H2
          else if (line.match(/^##\s/)) {
            inlineElements.push(
              <div key={`h2-${inlineKey++}`} className="text-base font-semibold text-vsc-text mt-2 mb-1">
                {line.replace(/^##\s/, '')}
              </div>
            );
          }
          // H1
          else if (line.match(/^#\s/)) {
            inlineElements.push(
              <div key={`h1-${inlineKey++}`} className="text-lg font-bold text-vsc-text mt-2 mb-1">
                {line.replace(/^#\s/, '')}
              </div>
            );
          }
          // Horizontal rule
          else if (line.match(/^---+$|^\*\*\*+$|^___+$/)) {
            inlineElements.push(
              <hr key={`hr-${inlineKey++}`} className="border-vsc-border my-3" />
            );
          }
          // Bullet list
          else if (line.match(/^[\s]*[-*]\s/)) {
            inlineElements.push(
              <div key={`list-${inlineKey++}`} className="flex gap-2 ml-2">
                <span className="text-vsc-text-muted">•</span>
                <span>{line.replace(/^[\s]*[-*]\s/, '')}</span>
              </div>
            );
          }
          // Numbered list
          else if (line.match(/^[\s]*\d+\.\s/)) {
            const num = line.match(/^[\s]*(\d+)\./)?.[1];
            inlineElements.push(
              <div key={`list-${inlineKey++}`} className="flex gap-2 ml-2">
                <span className="text-vsc-text-muted">{num}.</span>
                <span>{line.replace(/^[\s]*\d+\.\s/, '')}</span>
              </div>
            );
          }
          // Regular text
          else {
            inlineElements.push(
              <span key={`text-${inlineKey++}`}>
                {line}
                {i < lines.length - 1 && <br />}
              </span>
            );
          }
        }
      }
    }

    return inlineElements;
  };

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      elements.push(
        ...processInlineText(beforeText).map((el, i) => <span key={`pre-${key}-${i}`}>{el}</span>)
      );
    }

    // Add code block
    const language = match[1] || 'text';
    const code = match[2].trim();
    elements.push(
      <div
        key={`codeblock-${key++}`}
        className="my-2 rounded-lg overflow-hidden border border-vsc-border"
      >
        <div className="flex items-center justify-between px-3 py-1.5 bg-vsc-panel text-2xs text-vsc-text-muted font-mono">
          <span>{language}</span>
          <ButtonBase
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
              } catch {
                // Clipboard API may not be available
              }
            }}
            className="text-vsc-text-muted hover:text-vsc-text transition-colors"
          >
            <Copy size={12} />
          </ButtonBase>
        </div>
        <pre className="p-3 bg-vsc-terminal overflow-x-auto">
          <code className="text-xs font-mono text-vsc-text">{code}</code>
        </pre>
      </div>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    elements.push(
      ...processInlineText(remainingText).map((el, i) => <span key={`post-${key}-${i}`}>{el}</span>)
    );
  }

  return elements.length > 0 ? elements : [text];
}

/**
 * Single chat message component displaying user or assistant messages.
 * Uses VS Code theme colors for consistent styling.
 * Supports enhanced markdown rendering and message actions.
 */
export const ChatMessage = memo(function ChatMessage({
  message,
  onCopy,
  onEdit,
  onRegenerate,
  onDelete,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = typeof message.content === 'string'
      ? message.content
      : message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may not be available
    }
    onCopy?.(message.id);
  }, [message.content, message.id, onCopy]);

  const normalizedBlocks = useMemo(() => {
    if (typeof message.content === 'string') {
      return {
        text: message.content,
        images: [] as Array<Extract<ContentBlock, { type: 'image' }>>,
      };
    }

    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    const images = message.content.filter(
      (block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image'
    );

    return { text, images };
  }, [message.content]);

  const renderedContent = useMemo(() => {
    if (!normalizedBlocks.text) return null;
    return parseMarkdown(normalizedBlocks.text);
  }, [normalizedBlocks.text]);

  return (
    <div
      className={`group flex gap-3 p-4 ${isUser ? 'bg-transparent' : 'bg-white/[0.02]'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isUser ? 'bg-vsc-blue/20 text-vsc-blue' : 'bg-vsc-green/20 text-vsc-green'
        }`}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Role label + actions row */}
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-medium ${isUser ? 'text-vsc-blue' : 'text-vsc-green'}`}>
            {isUser ? t('chat.you') : t('chat.assistant')}
          </span>
          <span className="text-2xs text-vsc-text-muted">
            {new Date(message.timestamp).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {message.isStreaming && <LoadingSpinner size="xs" color="primary" />}
          {!isUser && message.routedProvider && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-input text-vsc-text-muted border border-vsc-border capitalize">
              {t('chat.routed')}: {message.routedProvider}
            </span>
          )}
          {!isUser && message.routedModel && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-input text-vsc-text-muted border border-vsc-border">
              {message.routedModel}
            </span>
          )}
          {!isUser && message.debug?.completionTokens != null && message.debug.completionTokens > 0 && message.debug?.durationMs != null && message.debug.durationMs > 0 && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-blue/10 text-vsc-blue border border-vsc-blue/30 font-mono">
              {((message.debug.completionTokens / message.debug.durationMs) * 1000).toFixed(1)} t/s
            </span>
          )}
          {!isUser && message.debug?.durationMs != null && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-input text-vsc-text-muted border border-vsc-border">
              {message.debug.durationMs} {t('chat.ms')}
            </span>
          )}
          {!isUser && message.debug?.completionTokens != null && message.debug.completionTokens > 0 && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-input text-vsc-text-muted border border-vsc-border font-mono">
              {message.debug.promptTokens ?? 0}→{message.debug.completionTokens} tok
            </span>
          )}
          {!isUser && message.debug?.contextUsagePct != null && message.debug.contextUsagePct > 0 && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-green/10 text-vsc-green border border-vsc-green/30 font-mono">
              ctx {message.debug.contextUsagePct.toFixed(1)}%
            </span>
          )}
          {!isUser && message.debug?.forceProvider && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-yellow/10 text-vsc-yellow border border-vsc-yellow/40 capitalize">
              {t('chat.forced')}: {message.debug.forceProvider}
            </span>
          )}

          {/* Message actions — visible on hover */}
          {showActions && !message.isStreaming && (
            <div className="flex items-center gap-0.5 ml-auto">
              <ButtonBase
                onClick={handleCopy}
                className="p-1 rounded hover:bg-vsc-hover text-vsc-text-muted hover:text-vsc-text transition-colors"
                title={t('chat.copyMessage') || 'Copy'}
              >
                {copied ? <Check size={13} className="text-vsc-green" /> : <Copy size={13} />}
              </ButtonBase>
              {isUser && onEdit && (
                <ButtonBase
                  onClick={() => onEdit(message.id)}
                  className="p-1 rounded hover:bg-vsc-hover text-vsc-text-muted hover:text-vsc-text transition-colors"
                  title={t('chat.editMessage') || 'Edit'}
                >
                  <Pencil size={13} />
                </ButtonBase>
              )}
              {!isUser && onRegenerate && (
                <ButtonBase
                  onClick={() => onRegenerate(message.id)}
                  className="p-1 rounded hover:bg-vsc-hover text-vsc-text-muted hover:text-vsc-text transition-colors"
                  title={t('chat.regenerate') || 'Regenerate'}
                >
                  <RefreshCw size={13} />
                </ButtonBase>
              )}
              {onDelete && (
                <ButtonBase
                  onClick={() => onDelete(message.id)}
                  className="p-1 rounded hover:bg-vsc-hover text-vsc-text-muted hover:text-vsc-red transition-colors"
                  title={t('chat.deleteMessage') || 'Delete'}
                >
                  <Trash2 size={13} />
                </ButtonBase>
              )}
            </div>
          )}
        </div>

        {/* Message content */}
        <div className="text-sm text-vsc-text break-words">
          {normalizedBlocks.images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {normalizedBlocks.images.map((block, index) => {
                const mediaType = block.source.mediaType || 'image/png';
                const data = block.source.data || '';
                const src = `data:${mediaType};base64,${data}`;
                return (
                  <ButtonBase
                    key={`${message.id}-img-${index}`}
                    onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
                    className="block border border-vsc-border rounded-lg overflow-hidden hover:border-vsc-blue/50 transition-colors"
                  >
                    <img
                      src={src}
                      alt={`attachment-${index + 1}`}
                      className="w-28 h-28 object-cover bg-vsc-input"
                    />
                  </ButtonBase>
                );
              })}
            </div>
          )}
          {renderedContent ||
            (message.isStreaming && (
              <span className="text-vsc-text-muted italic flex items-center gap-2">
                <LoadingSpinner size="xs" />
                {t('chat.thinking')}
              </span>
            ))}
          {message.isStreaming && normalizedBlocks.text && (
            <span className="inline-block w-2 h-4 ml-0.5 bg-vsc-blue animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatMessage;
