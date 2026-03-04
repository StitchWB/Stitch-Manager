import { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Square, Paperclip, X } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { LoadingSpinner, Textarea } from '../ui';
import type { ContentBlock } from '../../types/generated';

interface PendingAttachment {
  id: string;
  name: string;
  previewDataUrl: string;
  block: ContentBlock;
}

interface ChatInputProps {
  onSend: (content: string, attachments?: ContentBlock[]) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  allowImageAttachments?: boolean;
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
  allowImageAttachments = true,
  placeholder = 'Type a message...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  const updateTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, []);

  useEffect(() => {
    updateTextareaHeight();
  });

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if ((trimmed || attachments.length > 0) && !isLoading && !disabled) {
      onSend(
        trimmed,
        attachments.map(item => item.block)
      );
      setValue('');
      setAttachments([]);
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [value, attachments, isLoading, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleStop = useCallback(() => {
    if (onStop) {
      onStop();
    }
  }, [onStop]);

  const handleFilesSelected = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
      if (!allowImageAttachments) {
        return;
      }

      const readAsDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
          reader.readAsDataURL(file);
        });

      const nextAttachments: PendingAttachment[] = [];
      for (const file of imageFiles) {
        const dataUrl = await readAsDataUrl(file);
        const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        nextAttachments.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: file.name,
          previewDataUrl: dataUrl,
          block: {
            type: 'image',
            source: {
              sourceType: 'base64',
              mediaType: file.type || null,
              data: base64Data,
            },
          },
        });
      }

      if (nextAttachments.length > 0) {
        setAttachments(prev => [...prev, ...nextAttachments]);
      }
    },
    [allowImageAttachments]
  );

  const handlePickFiles = useCallback(() => {
    if (!allowImageAttachments || disabled || isLoading) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      void handleFilesSelected(input.files);
      input.remove();
    };
    input.click();
  }, [allowImageAttachments, disabled, isLoading, handleFilesSelected]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id));
  }, []);

  return (
    <div className="border-t border-vsc-border bg-vsc-sidebar/50 p-4">
      {attachments.length > 0 && (
        <div className="max-w-4xl mx-auto mb-3 flex flex-wrap gap-2">
          {attachments.map(item => (
            <div
              key={item.id}
              className="relative group border border-vsc-border rounded-lg overflow-hidden bg-vsc-input"
            >
              <img src={item.previewDataUrl} alt={item.name} className="w-16 h-16 object-cover" />
              <button
                type="button"
                onClick={() => removeAttachment(item.id)}
                className="absolute -top-1 -right-1 p-1 rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove ${item.name}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-3 max-w-4xl mx-auto">
        {/* Input area */}
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="px-4 py-3 bg-vsc-input border border-vsc-border text-sm text-vsc-text placeholder-vsc-text-muted focus:border-vsc-blue/50 focus:ring-1 focus:ring-vsc-blue/30 resize-none overflow-hidden transition-colors"
            shellClassName="bg-vsc-input border-vsc-border"
            style={{ minHeight: '44px', maxHeight: '200px' }}
          />
          <div className="absolute bottom-1.5 right-2 text-2xs text-vsc-text-muted">
            {(value.length > 0 || attachments.length > 0) && (
              <span>Press Enter to send, Shift+Enter for new line</span>
            )}
          </div>
        </div>

        {allowImageAttachments ? (
          <Tooltip content="Attach images">
            <button
              type="button"
              onClick={handlePickFiles}
              disabled={disabled || isLoading}
              className="p-3 bg-vsc-input border border-vsc-border hover:border-vsc-blue/50 text-vsc-text-muted
                         rounded-lg transition-colors flex items-center justify-center
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Paperclip size={18} />
            </button>
          </Tooltip>
        ) : null}

        {/* Send/Stop button */}
        {isLoading ? (
          <Tooltip content="Stop generation">
            <button
              type="button"
              onClick={handleStop}
              className="p-3 bg-vsc-red/20 hover:bg-vsc-red/30 text-vsc-red 
                         rounded-lg transition-colors flex items-center justify-center"
            >
              <Square size={18} fill="currentColor" />
            </button>
          </Tooltip>
        ) : (
          <Tooltip content="Send message">
            <button
              type="button"
              onClick={handleSend}
              disabled={(!value.trim() && attachments.length === 0) || disabled}
              className="p-3 bg-vsc-blue/20 hover:bg-vsc-blue/30 text-vsc-blue 
                         rounded-lg transition-colors flex items-center justify-center
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-vsc-blue/20"
            >
              {disabled ? <LoadingSpinner size="sm" color="primary" /> : <Send size={18} />}
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default ChatInput;
