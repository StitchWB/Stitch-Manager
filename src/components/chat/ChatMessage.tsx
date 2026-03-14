import { memo, useMemo } from 'react';
import { User, Bot } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '../../stores/chat';
import type { ContentBlock } from '../../types/generated';
import { t } from '../../lib/i18n';
import { ButtonBase, LoadingSpinner } from '@/components/ui';


interface ChatMessageProps {
  message: ChatMessageType;
}

/**
 * Simple markdown parser for chat messages.
 * Supports: bold, inline code, code blocks, and lists.
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

    // Process inline elements: bold, inline code
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

    for (const part of parts) {
      if (!part) continue;

      // Bold text
      if (part.startsWith('**') && part.endsWith('**')) {
        inlineElements.push(
          <strong key={`bold-${inlineKey++}`} className="font-semibold text-vsc-text">
            {part.slice(2, -2)}
          </strong>
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
      // Regular text - check for lists
      else {
        const lines = part.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Bullet list
          if (line.match(/^[\s]*[-*]\s/)) {
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
        <div className="px-3 py-1.5 bg-vsc-panel text-2xs text-vsc-text-muted font-mono">
          {language}
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
 * Supports basic markdown rendering.
 */
export const ChatMessage = memo(function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

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
    <div className={`flex gap-3 p-4 ${isUser ? 'bg-transparent' : 'bg-white/[0.02]'}`}>
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
        {/* Role label */}
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
              routed: {message.routedProvider}
            </span>
          )}
          {!isUser && message.routedModel && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-input text-vsc-text-muted border border-vsc-border">
              {message.routedModel}
            </span>
          )}
          {!isUser && message.debug?.durationMs != null && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-input text-vsc-text-muted border border-vsc-border">
              {message.debug.durationMs} ms
            </span>
          )}
          {!isUser && message.debug?.forceProvider && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-vsc-yellow/10 text-vsc-yellow border border-vsc-yellow/40 capitalize">
              forced: {message.debug.forceProvider}
            </span>
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
