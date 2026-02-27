const SettingsPage = () => {
  return (
    <div className="space-y-6 animate-slide-in max-w-2xl">
      <h1 className="text-lg font-semibold">Settings</h1>
      
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-semibold">Data Sources</h3>
        <p className="text-xs text-muted-foreground">Configure which central bank sources to track and their trust weights.</p>
        <div className="bg-surface rounded p-3 text-xs text-muted-foreground">
          Source configuration will be available once the backend algorithm is integrated.
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-semibold">API Integration</h3>
        <p className="text-xs text-muted-foreground">Connect to the central bank communication scraping pipeline.</p>
        <div className="bg-surface rounded p-3 text-xs text-muted-foreground">
          API endpoint configuration pending backend deployment.
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-semibold">Display Preferences</h3>
        <p className="text-xs text-muted-foreground">Customize dashboard layout and data display options.</p>
        <div className="bg-surface rounded p-3 text-xs text-muted-foreground">
          Preferences panel will be implemented in a future update.
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
