import { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Square, Loader2 } from 'lucide-react';

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Chat input component with send button and keyboard shortcuts.
 * Supports multi-line input with Shift+Enter and sends on Enter.
 */
export function ChatInput({
  onSend,
  onStop,
  isLoading = false,
  disabled = false,
  placeholder = 'Type a message...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && !isLoading && !disabled) {
      onSend(trimmed);
      setValue('');
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [value, isLoading, disabled, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleStop = useCallback(() => {
    if (onStop) {
      onStop();
    }
  }, [onStop]);

  return (
    <div className="border-t border-vsc-border bg-vsc-sidebar/50 p-4">
      <div className="flex items-end gap-3 max-w-4xl mx-auto">
        {/* Input area */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full px-4 py-3 bg-vsc-input border border-vsc-border rounded-lg 
                       text-sm text-vsc-text placeholder-vsc-text-muted
                       focus:outline-none focus:border-vsc-blue/50 focus:ring-1 focus:ring-vsc-blue/30
                       disabled:opacity-50 disabled:cursor-not-allowed
                       resize-none overflow-hidden transition-colors"
            style={{ minHeight: '44px', maxHeight: '200px' }}
          />
          <div className="absolute bottom-1.5 right-2 text-2xs text-vsc-text-muted">
            {value.length > 0 && (
              <span>Press Enter to send, Shift+Enter for new line</span>
            )}
          </div>
        </div>

        {/* Send/Stop button */}
        {isLoading ? (
          <button
            onClick={handleStop}
            className="p-3 bg-vsc-red/20 hover:bg-vsc-red/30 text-vsc-red 
                       rounded-lg transition-colors flex items-center justify-center"
            title="Stop generation"
          >
            <Square size={18} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            className="p-3 bg-vsc-blue/20 hover:bg-vsc-blue/30 text-vsc-blue 
                       rounded-lg transition-colors flex items-center justify-center
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-vsc-blue/20"
            title="Send message"
          >
            {disabled ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default ChatInput;
