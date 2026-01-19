import { useRef, useEffect } from 'react';
import { MessageSquare, Loader2 } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { t } from '../../lib/i18n';
import type { ChatMessage as ChatMessageType } from '../../stores/chat';

interface ChatHistoryProps {
  messages: ChatMessageType[];
  isLoading?: boolean;
}

/**
 * Scrollable chat message history component.
 * Auto-scrolls to bottom when new messages arrive.
 */
export function ChatHistory({ messages, isLoading }: ChatHistoryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-vsc-panel flex items-center justify-center mb-4">
          <MessageSquare size={32} className="text-vsc-text-muted" />
        </div>
        <h3 className="text-lg font-medium text-vsc-text mb-2">
          {t('chat.emptyTitle')}
        </h3>
        <p className="text-sm text-vsc-text-muted max-w-md">
          {t('chat.emptyDescription')}
        </p>
        <div className="mt-6 flex flex-wrap gap-2 justify-center">
          {['Explain this code', 'Help me debug', 'Write a function'].map((suggestion) => (
            <span
              key={suggestion}
              className="px-3 py-1.5 text-xs bg-vsc-input border border-vsc-border 
                         rounded-full text-vsc-text-muted"
            >
              {suggestion}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto"
    >
      <div className="max-w-4xl mx-auto">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        
        {/* Typing indicator when loading and last message is not streaming */}
        {isLoading && messages.length > 0 && !messages[messages.length - 1]?.isStreaming && (
          <div className="flex gap-3 p-4 bg-white/[0.02]">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-vsc-green/20 text-vsc-green">
              <Loader2 size={16} className="animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-vsc-green">
                  {t('chat.assistant')}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-vsc-text-muted">
                <span className="w-2 h-2 bg-vsc-text-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-vsc-text-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-vsc-text-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default ChatHistory;
