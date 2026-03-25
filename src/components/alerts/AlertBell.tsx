import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export function AlertBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const { data: recentAlerts = [] } = useQuery({
    queryKey: ['recent-alerts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_history' as any)
        .select('*')
        .order('triggered_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data || []) as unknown as { id: string; triggered_at: string; message: string; current_value: number }[];
    },
    enabled: !!user,
    refetchInterval: 60000,
  });

  // Count alerts in last 24h
  const recentCount = recentAlerts.filter(a => {
    const age = Date.now() - new Date(a.triggered_at).getTime();
    return age < 24 * 60 * 60 * 1000;
  }).length;

  if (!user) {
    return (
      <Link to="/login">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 relative">
          <Bell className="w-4 h-4 text-muted-foreground" />
        </Button>
      </Link>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 relative">
          <Bell className="w-4 h-4 text-muted-foreground" />
          {recentCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
              {recentCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="p-3 border-b border-border">
          <p className="text-xs font-semibold">Alerts</p>
        </div>
        <div className="max-h-60 overflow-y-auto">
          {recentAlerts.length === 0 ? (
            <p className="text-[10px] text-muted-foreground text-center py-4">No recent alerts</p>
          ) : (
            recentAlerts.map(alert => (
              <div key={alert.id} className="px-3 py-2 border-b border-border/50 last:border-0 hover:bg-accent/30">
                <p className="text-[10px] text-foreground truncate">{alert.message}</p>
                <p className="text-[9px] text-muted-foreground font-mono">
                  {new Date(alert.triggered_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
        <div className="p-2 border-t border-border">
          <Link to="/alerts" onClick={() => setOpen(false)}>
            <Button variant="ghost" size="sm" className="w-full text-xs h-7">Manage Alerts</Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
