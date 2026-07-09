export default function SettingsPage() {
  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure dashboard preferences</p>
      </div>
      <div className="bg-card border p-6 rounded-lg text-center text-muted-foreground">
        Configuration interface coming soon. Settings are currently managed via the <code>.env</code> file.
      </div>
    </div>
  );
}
