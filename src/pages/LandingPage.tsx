interface LandingPageProps {
  onLogin: () => void;
  onRegister: () => void;
}

const features = [
  {
    number: '01',
    title: 'Durable job acceptance',
    description: 'Persist each job and its dispatch event together before queue delivery begins.'
  },
  {
    number: '02',
    title: 'Automatic retries',
    description: 'Retry transient failures with configurable attempt limits and exponential backoff.'
  },
  {
    number: '03',
    title: 'Idempotent submissions',
    description: 'Use an idempotency key to safely handle repeated submission requests.'
  },
  {
    number: '04',
    title: 'Independent workers',
    description: 'Process queued work outside the API process with configurable concurrency.'
  },
  {
    number: '05',
    title: 'Queue visibility',
    description: 'Inspect live queue counts, worker heartbeats, pressure, and outbox activity.'
  },
  {
    number: '06',
    title: 'Failure recovery',
    description: 'Reconcile pending dispatches and recover stale jobs through the dispatcher.'
  }
];

export const LandingPage: React.FC<LandingPageProps> = ({ onLogin, onRegister }) => (
  <div className="tf-landing">
    <section className="tf-hero" aria-labelledby="landing-title">
      <div className="tf-hero-copy">
        <span className="tf-eyebrow"><span className="tf-eyebrow-dot" /> Background work, under control</span>
        <h1 id="landing-title">Reliable work keeps your product <span>moving.</span></h1>
        <p className="tf-hero-description">
          TaskFlow gives your application a dependable path for background jobs—from durable submission to worker execution, retries, and recovery.
        </p>
        <div className="tf-hero-actions">
          <button type="button" className="tf-btn-primary tf-btn-large" onClick={onRegister}>Create your workspace <span aria-hidden="true">→</span></button>
          <button type="button" className="tf-btn-secondary tf-btn-large" onClick={onLogin}>Sign in</button>
        </div>
        <div className="tf-hero-note"><span className="tf-note-check" aria-hidden="true">✓</span> Built around queues, workers, and durable job state</div>
      </div>

      <div className="tf-flow-card" aria-label="Background job processing flow">
        <div className="tf-flow-card-head">
          <div><span className="tf-overline">THE PROCESSING FLOW</span><h2>From request to result</h2></div>
          <span className="tf-live-indicator"><span /> Event-driven</span>
        </div>
        <div className="tf-flow-list">
          <div className="tf-flow-step">
            <span className="tf-flow-icon tf-flow-icon-orange" aria-hidden="true">↗</span>
            <div><strong>Application</strong><span>Submit a job</span></div>
            <span className="tf-flow-index">01</span>
          </div>
          <div className="tf-flow-connector" />
          <div className="tf-flow-step">
            <span className="tf-flow-icon tf-flow-icon-dark" aria-hidden="true">▤</span>
            <div><strong>TaskFlow queue</strong><span>Persist · dispatch · retry</span></div>
            <span className="tf-flow-index">02</span>
          </div>
          <div className="tf-flow-connector" />
          <div className="tf-flow-step">
            <span className="tf-flow-icon tf-flow-icon-light" aria-hidden="true">⌘</span>
            <div><strong>Worker</strong><span>Execute independently</span></div>
            <span className="tf-flow-index">03</span>
          </div>
          <div className="tf-flow-connector" />
          <div className="tf-flow-step tf-flow-step-result">
            <span className="tf-flow-icon tf-flow-icon-success" aria-hidden="true">✓</span>
            <div><strong>Observable result</strong><span>Status and outcome</span></div>
            <span className="tf-flow-index">04</span>
          </div>
        </div>
        <div className="tf-flow-footer"><span>PostgreSQL</span><span className="tf-flow-footer-line" /><span>BullMQ + Redis</span></div>
      </div>
    </section>

    <section className="tf-feature-section" aria-labelledby="features-title">
      <div className="tf-section-heading">
        <span className="tf-overline">THE RIGHT FOUNDATIONS</span>
        <h2 id="features-title">Background processing you can reason about.</h2>
        <p>Practical reliability patterns and operational visibility, built into one focused workflow.</p>
      </div>
      <div className="tf-feature-grid">
        {features.map((feature) => (
          <article className="tf-feature-card" key={feature.number}>
            <span className="tf-feature-number">{feature.number}</span>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>
        ))}
      </div>
    </section>

    <footer className="tf-landing-footer">
      <span>TaskFlow <span className="tf-footer-divider">/</span> Background jobs, made observable.</span>
      <button type="button" className="tf-btn-link" onClick={onLogin}>Operator sign in <span aria-hidden="true">→</span></button>
    </footer>
  </div>
);
