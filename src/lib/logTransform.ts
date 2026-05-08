export interface TransformedLog {
  displayMessage: string;
  sourceTag: string | null;
  pythonLevel: string | null;
  phaseTag: string | null;
}

const PYTHON_LOG_RE =
  /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d{3})\s+-\s+([\w.]+)\s+-\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+-\s+(.*)$/;

const PHASE_RE = /^\[Phase\s+(\d+(?:\.\d+)?)\]\s*/;

const PYTHON_TO_UI_LEVEL: Record<string, 'debug' | 'info' | 'warn' | 'error' | 'success'> = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warn',
  ERROR: 'error',
  CRITICAL: 'error',
};

function shortenModule(modulePath: string): string {
  const parts = modulePath.split('.');
  if (parts.length <= 2) return modulePath;
  if (parts[0] === 'autoreg' && parts.length >= 3) {
    return parts.slice(1, 3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function transformPythonLog(rawMessage: string): TransformedLog & { isPythonLog: boolean } {
  const m = rawMessage.match(PYTHON_LOG_RE);
  if (!m) {
    return {
      isPythonLog: false,
      displayMessage: rawMessage,
      sourceTag: null,
      pythonLevel: null,
      phaseTag: null,
    };
  }

  const modulePath = m[2];
  const pythonLevel = m[3];
  let body = m[4].trim();

  const phaseMatch = body.match(PHASE_RE);
  let phaseTag: string | null = null;
  if (phaseMatch) {
    phaseTag = `P${phaseMatch[1]}`;
    body = body.slice(phaseMatch[0].length);
  }

  return {
    isPythonLog: true,
    displayMessage: body,
    sourceTag: shortenModule(modulePath),
    pythonLevel,
    phaseTag,
  };
}

export function remapLogLevel(rawLevel: string, rawMessage: string): string {
  const t = transformPythonLog(rawMessage);
  if (t.isPythonLog && t.pythonLevel) {
    return PYTHON_TO_UI_LEVEL[t.pythonLevel] ?? rawLevel;
  }
  return rawLevel;
}

export interface CleanLogEntry {
  displayMessage: string;
  sourceTag: string | null;
  phaseTag: string | null;
  isPythonLog: boolean;
}

export function cleanLogMessage(rawMessage: string): CleanLogEntry {
  const t = transformPythonLog(rawMessage);
  return {
    displayMessage: t.displayMessage,
    sourceTag: t.sourceTag,
    phaseTag: t.phaseTag,
    isPythonLog: t.isPythonLog,
  };
}
