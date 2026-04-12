import WorkbenchShell from "./ui/workbench-shell";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const { listTemplates } = configModule;
  const auth = {
    authenticated: false,
    authSource: "loading",
    email: null,
    profile: null,
  };

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Weavy Agent Workbench</p>
          <h1>Author workflow apps with the agent, then graduate the flow into a product UI.</h1>
          <p className="lede">
            The current loop can plan, draft, graft safe structure, estimate spend,
            and prepare sandbox execution against live Weavy flows. This UI is the
            first Next.js shell around that engine.
          </p>
        </div>
        <div className="hero-meta">
          <div className="status-card">
            <span className="status-dot" />
            <div>
              <p>Session</p>
              <strong>Browser-synced</strong>
            </div>
          </div>
          <dl className="meta-list">
            <div>
              <dt>Auth Source</dt>
              <dd>{auth.authSource}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>Detected client-side</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>Loaded after hydration</dd>
            </div>
          </dl>
        </div>
      </section>

      <WorkbenchShell initialAuth={auth} initialTemplates={listTemplates()} />
    </main>
  );
}
