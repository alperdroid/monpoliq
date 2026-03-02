import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Search } from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center justify-between border-b border-border px-4 bg-card/80 backdrop-blur-sm flex-shrink-0">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              <div className="hidden md:flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
                <span>Monetary Policy Intelligence</span>
                <span className="text-border">|</span>
                <span className="text-primary font-semibold">FED</span>
                <span className="text-muted-foreground/40">/</span>
                <span className="text-primary font-semibold">ECB</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 border border-border/50">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search events, speakers..."
                  className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none w-48"
                />
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-4 md:p-6 bg-background">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
