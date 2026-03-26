import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { LayoutDashboard, Calendar, Users, Radio, TrendingUp, BarChart3, MessageSquare, Shield, Grid3X3, Layers, Crosshair, FlaskConical, Bell, Settings, Search } from 'lucide-react';

const pages = [
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
  { title: 'Events Explorer', url: '/events', icon: Radio },
  { title: 'Speakers', url: '/speakers', icon: Users },
  { title: 'Meeting Cycles', url: '/meetings', icon: Calendar },
  { title: 'Statistical Data', url: '/stats', icon: BarChart3 },
  { title: 'Communications', url: '/comms', icon: MessageSquare },
  { title: 'Predictions', url: '/predictions', icon: TrendingUp },
  { title: 'Empirical Policy', url: '/empirical', icon: FlaskConical },
  { title: 'Topic Heatmaps', url: '/topics', icon: Grid3X3 },
  { title: 'Policy Taxonomy', url: '/taxonomy', icon: Layers },
  { title: 'Policy Radar', url: '/radar', icon: Crosshair },
  { title: 'Committee', url: '/committee', icon: Shield },
  { title: 'Alerts', url: '/alerts', icon: Bell },
  { title: 'Settings', url: '/settings', icon: Settings },
];

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const handleSelect = (url: string) => {
    setOpen(false);
    navigate(url);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden sm:flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 border border-border/50 hover:border-border transition-colors cursor-pointer"
      >
        <Search className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground w-48 text-left">Search pages...</span>
        <kbd className="text-[9px] text-muted-foreground/60 bg-background px-1.5 py-0.5 rounded border border-border/50 font-mono">⌘K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages, events, speakers..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Pages">
            {pages.map(p => (
              <CommandItem key={p.url} onSelect={() => handleSelect(p.url)} className="cursor-pointer">
                <p.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{p.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
