import { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  getPromptContent,
  savePromptContent,
  getDefaultPromptContent,
  resetPromptToDefault,
} from '../lib/tauri';
import { Tooltip } from './Tooltip';
import { Button, LoadingSpinner, Textarea } from '@/components/ui';


interface PromptEditorProps {
  promptName: string;
  title: string;
  description: string;
}

export default function PromptEditor({ promptName, title, description }: PromptEditorProps) {
  const [content, setContent] = useState('');
  const [defaultContent, setDefaultContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isModified, setIsModified] = useState(false);

  const loadPrompt = useCallback(async () => {
    try {
      setIsLoading(true);

      // Load default content
      const defContent = await getDefaultPromptContent(promptName);
      setDefaultContent(defContent);

      // Try to load user content, fallback to default
      try {
        const userContent = await getPromptContent(promptName);
        setContent(userContent);
        setIsModified(userContent !== defContent);
      } catch {
        setContent(defContent);
        setIsModified(false);
      }
    } catch (error) {
      toast.error(`Failed to load prompt: ${error}`);
      setContent('');
    } finally {
      setIsLoading(false);
    }
  }, [promptName]);

  useEffect(() => {
    loadPrompt();
  }, [loadPrompt]);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await savePromptContent(promptName, content);
      setIsModified(content !== defaultContent);
      toast.success('Prompt saved successfully');
    } catch (error) {
      toast.error(`Failed to save prompt: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      setIsSaving(true);
      await resetPromptToDefault(promptName);
      setContent(defaultContent);
      setIsModified(false);
      toast.success('Prompt reset to Kiro default');
    } catch (error) {
      toast.error(`Failed to reset prompt: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="md" />
        <span className="ml-2 text-slate-400 text-sm">Loading prompt...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-indigo-400" />
          <div>
            <h4 className="text-white font-medium">{title}</h4>
            <p className="text-slate-400 text-xs">{description}</p>
          </div>
          {isModified && (
            <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded border border-amber-500/30">
              Modified
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Tooltip content="Reset to Kiro default">
            <Button
              onClick={handleReset}
              disabled={isSaving || !isModified}
              variant="secondary"
              size="sm"
              leftIcon={<RotateCcw className="w-4 h-4" />}
            >
              Reset to Default
            </Button>
          </Tooltip>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            variant="primary"
            size="sm"
            leftIcon={isSaving ? <LoadingSpinner size="sm" /> : <Save className="w-4 h-4" />}
          >
            Save
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="relative">
        <Textarea
          value={content}
          onChange={e => {
            setContent(e.target.value);
            setIsModified(e.target.value !== defaultContent);
          }}
          className="h-96 input-ds font-mono text-sm resize-none"
          placeholder="Enter prompt content..."
          spellCheck={false}
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-2 text-xs text-slate-500">
          <span>{content.length} characters</span>
          <span>•</span>
          <span>{content.split('\n').length} lines</span>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 text-sm">
        {isModified ? (
          <>
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400">Unsaved changes</span>
          </>
        ) : (
          <>
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-green-400">Using Kiro default</span>
          </>
        )}
      </div>
    </div>
  );
}
