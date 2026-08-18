import { safeInvoke } from '../core';

export interface NotebookLMNotebook {
  id: string;
  title: string;
}

export interface NotebookLMListResult {
  notebooks: NotebookLMNotebook[];
}

export async function notebooklmListNotebooks(): Promise<NotebookLMNotebook[]> {
  return safeInvoke<NotebookLMNotebook[]>('notebooklm_list_notebooks', {});
}

export async function notebooklmCreateNotebook(params: {
  title: string;
}): Promise<NotebookLMNotebook> {
  return safeInvoke<NotebookLMNotebook>('notebooklm_create_notebook', {
    title: params.title,
  });
}

export async function notebooklmAsk(params: {
  notebookId: string;
  question: string;
}): Promise<{ answer: string }> {
  return safeInvoke<{ answer: string }>('notebooklm_ask', {
    notebookId: params.notebookId,
    question: params.question,
  });
}

export async function notebooklmGenerateAudio(params: {
  notebookId: string;
  instructions?: string;
}): Promise<{ task_id: string }> {
  return safeInvoke<{ task_id: string }>('notebooklm_generate_audio', {
    notebookId: params.notebookId,
    instructions: params.instructions,
  });
}
