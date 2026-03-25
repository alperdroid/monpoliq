import { AlertRulesPanel } from '@/components/alerts/AlertRulesPanel';
import { Bell } from 'lucide-react';

const Alerts = () => {
  return (
    <div className="space-y-6 animate-slide-in max-w-3xl">
      <div className="flex items-center gap-2">
        <Bell className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">Alerts & Watchlist</h1>
      </div>
      <p className="text-xs text-muted-foreground">
        Set custom thresholds on sentiment metrics and get notified when conditions are met.
      </p>
      <AlertRulesPanel />
    </div>
  );
};

export default Alerts;
