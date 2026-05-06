export function SettingsView() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Configure your application preferences.
        </p>
      </div>
      
      <div className="rounded-xl border bg-card text-card-foreground shadow mt-4 p-6">
        <div className="flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-base font-semibold">General Preferences</h3>
              <p className="text-sm text-muted-foreground">Manage your basic application behavior.</p>
            </div>
          </div>
          {/* Settings form fields will go here */}
        </div>
      </div>
    </div>
  );
}
