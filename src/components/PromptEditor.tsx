import { useState, useEffect } from 'react';
import { Save, RotateCcw, FileText, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  getPromptContent,
  savePromptContent,
  getDefaultPromptContent,
  resetPromptToDefault,
} from '../lib/tauri';

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

  useEffect(() => {
    loadPrompt();
  }, [promptName]);

  const loadPrompt = async () => {
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
  };

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
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
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
          <button
            onClick={handleReset}
            disabled={isSaving || !isModified}
            className="btn-secondary text-sm flex items-center gap-2"
            title="Reset to Kiro default"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to Default
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="relative">
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setIsModified(e.target.value !== defaultContent);
          }}
          className="w-full h-96 input-ds font-mono text-sm resize-none"
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
