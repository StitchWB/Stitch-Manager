// Stitch Toolkit — Panel UI (runs in isolated content-script world)
import { loadTools, getActiveTool, setActiveTool } from './tools/registry.js';

const STORAGE_KEYS = {
  collapsed: 'toolkit:collapsed',
  activeTool: 'toolkit:activeTool',
};

function getShadowRoot() {
  const host = document.getElementById('stitch-toolkit-shadow');
  if (!host) return null;
  return host.shadowRoot;
}

function saveState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function loadState(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

export function initPanel() {
  // Prevent double init
  if (document.getElementById('stitch-toolkit-shadow')) return;

  const host = document.createElement('div');
  host.id = 'stitch-toolkit-shadow';
  host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;width:0;height:0;overflow:visible;';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const panel = document.createElement('div');
  panel.id = 'stitch-toolkit-panel';
  panel.className = 'tk-panel';
  panel.innerHTML = `
    <div class="tk-header">
      <div class="tk-brand">
        <div class="tk-logo">⚙</div>
        <span class="tk-title">Stitch Toolkit</span>
      </div>
      <button class="tk-toggle" id="tk-toggle" title="Collapse/Expand">▶</button>
      <button class="tk-close" id="tk-close" title="Hide panel (reload to restore)">✕</button>
    </div>
    <div class="tk-body" id="tk-body">
      <div class="tk-menu" id="tk-menu"></div>
      <div class="tk-tool-area" id="tk-tool-area"></div>
    </div>
  `;
  shadow.appendChild(panel);

  const toggle = panel.querySelector('#tk-toggle');
  const closeBtn = panel.querySelector('#tk-close');
  const body = panel.querySelector('#tk-body');
  const menu = panel.querySelector('#tk-menu');
  const toolArea = panel.querySelector('#tk-tool-area');

  // Restore collapsed state
  const collapsed = loadState(STORAGE_KEYS.collapsed, false);
  if (collapsed) panel.classList.add('tk-collapsed');
  updateToggleIcon(collapsed);

  toggle.addEventListener('click', () => {
    const nowCollapsed = !panel.classList.contains('tk-collapsed');
    panel.classList.toggle('tk-collapsed', nowCollapsed);
    saveState(STORAGE_KEYS.collapsed, nowCollapsed);
    updateToggleIcon(nowCollapsed);
  });

  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
  });

  function updateToggleIcon(isCollapsed) {
    toggle.textContent = isCollapsed ? '◀' : '▶';
    toggle.title = isCollapsed ? 'Expand' : 'Collapse';
  }

  // Load tools
  const tools = loadTools();
  const activeToolId = loadState(STORAGE_KEYS.activeTool, tools[0]?.id || null);

  // Render menu
  menu.innerHTML = '';
  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className = 'tk-tool-btn';
    btn.dataset.id = tool.id;
    btn.innerHTML = `<span>${tool.icon}</span> <span>${tool.name}</span>`;
    btn.addEventListener('click', () => activateTool(tool.id));
    menu.appendChild(btn);
  }

  function activateTool(id) {
    const tool = tools.find(t => t.id === id);
    if (!tool) return;

    // Update menu
    for (const btn of menu.querySelectorAll('.tk-tool-btn')) {
      btn.classList.toggle('tk-active', btn.dataset.id === id);
    }

    // Clear and mount tool
    toolArea.innerHTML = '';
    if (typeof tool.mount === 'function') {
      tool.mount(toolArea);
    } else {
      toolArea.innerHTML = `<div class="tk-hint">Tool "${tool.name}" has no UI.</div>`;
    }

    setActiveTool(id);
    saveState(STORAGE_KEYS.activeTool, id);
  }

  // Activate initial
  if (activeToolId) {
    activateTool(activeToolId);
  } else if (tools.length) {
    activateTool(tools[0].id);
  }
}
