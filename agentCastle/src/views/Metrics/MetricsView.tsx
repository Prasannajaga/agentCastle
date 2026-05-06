export function MetricsView() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Metrics</h1>
        <p className="text-muted-foreground mt-2">
          View system performance and agent analytics.
        </p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-3 mt-4">
        <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
          <h3 className="font-semibold tracking-tight text-sm text-muted-foreground">Total Operations</h3>
          <div className="text-2xl font-bold mt-2">0</div>
        </div>
        <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
          <h3 className="font-semibold tracking-tight text-sm text-muted-foreground">Success Rate</h3>
          <div className="text-2xl font-bold mt-2">0.0%</div>
        </div>
        <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
          <h3 className="font-semibold tracking-tight text-sm text-muted-foreground">System Load</h3>
          <div className="text-2xl font-bold mt-2">Idle</div>
        </div>
      </div>
    </div>
  );
}
