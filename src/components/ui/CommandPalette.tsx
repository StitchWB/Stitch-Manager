import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Users, RefreshCw, Code, Server, 
  Settings, FileText, Search 
} from 'lucide-react';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Toggle on Cmd+K / Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Menu"
      className="fixed inset-0 z-50"
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      
      {/* Dialog */}
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg">
        <div 
          className="rounded-xl overflow-hidden shadow-2xl"
          style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {/* Search Input */}
          <div className="flex items-center px-4 border-b border-white/5">
            <Search className="w-4 h-4 text-slate-500 mr-3" />
            <Command.Input 
              placeholder="Type a command or search..."
              className="w-full h-12 bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
            />
            <kbd className="px-2 py-1 text-[10px] text-slate-500 bg-white/5 rounded">ESC</kbd>
          </div>

          {/* Results */}
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-slate-500">
              No results found.
            </Command.Empty>

            <Command.Group heading="Navigation" className="mb-2">
              <CommandItem icon={<LayoutDashboard />} onSelect={() => runCommand(() => navigate('/'))}>
                Dashboard
              </CommandItem>
              <CommandItem icon={<Users />} onSelect={() => runCommand(() => navigate('/accounts'))}>
                Accounts
              </CommandItem>
              <CommandItem icon={<RefreshCw />} onSelect={() => runCommand(() => navigate('/autoreg'))}>
                Auto Registration
              </CommandItem>
              <CommandItem icon={<Code />} onSelect={() => runCommand(() => navigate('/patcher'))}>
                IDE Patcher
              </CommandItem>
              <CommandItem icon={<Server />} onSelect={() => runCommand(() => navigate('/server'))}>
                API Server
              </CommandItem>
              <CommandItem icon={<Settings />} onSelect={() => runCommand(() => navigate('/settings'))}>
                Settings
              </CommandItem>
              <CommandItem icon={<FileText />} onSelect={() => runCommand(() => navigate('/logs'))}>
                Logs
              </CommandItem>
            </Command.Group>

            <Command.Group heading="Actions" className="mb-2">
              <CommandItem icon={<RefreshCw />} onSelect={() => runCommand(() => {/* refresh all */})}>
                Refresh All Accounts
              </CommandItem>
            </Command.Group>
          </Command.List>
        </div>
      </div>
    </Command.Dialog>
  );
}

// Helper component for items
function CommandItem({ children, icon, onSelect }: { children: React.ReactNode; icon: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer data-[selected=true]:bg-indigo-600 data-[selected=true]:text-white transition-colors"
    >
      <span className="w-4 h-4 opacity-60">{icon}</span>
      {children}
    </Command.Item>
  );
}
