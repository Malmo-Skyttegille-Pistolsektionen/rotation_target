import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "@shoelace-style/shoelace/dist/themes/light.css";
import { setBasePath } from "@shoelace-style/shoelace/dist/utilities/base-path.js";
import { registerIconLibrary } from "@shoelace-style/shoelace/dist/utilities/icon-library.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/select/select.js";
import "@shoelace-style/shoelace/dist/components/option/option.js";
import "./index.css";


declare const __APP_VERSION__: string;

setBasePath('/shoelace');

registerIconLibrary('default', {
  resolver: (name) => `/icons/${name}.svg`,
  mutator: (svg) => svg.setAttribute('fill', 'currentColor')
});

function App() {
  const [programs, setPrograms] = useState<Record<string, string>>({});
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/programs')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch programs');
        return res.json();
      })
      .then((data) => setPrograms(data.programs))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const startProgram = () => {
    if (selectedProgramId) fetch(`/api/programs/${selectedProgramId}/start`, { method: 'POST' });
  };

  const stopProgram = () => {
    if (selectedProgramId) fetch(`/api/programs/${selectedProgramId}/stop`, { method: 'POST' });
  };

  const turnTarget = () => {
    fetch('/api/target/turn', { method: 'POST' });
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      padding: '1rem',
      textAlign: 'center',
      fontFamily: 'system-ui, sans-serif',
      boxSizing: 'border-box'
    }}>

      {/* Centered logo */}
      <img
        src="/msg_logo.png"
        alt="MSG Logo"
        style={{
          width: '100px',
          marginBottom: '1rem',
          display: 'block',
          marginLeft: 'auto',
          marginRight: 'auto'
        }}
      />

      {/* Turn Targets button */}
      <div style={{ marginBottom: '2rem' }}>
        <sl-button variant="primary" onClick={turnTarget}>
          Turn Targets
        </sl-button>
      </div>

      {loading && <p>Loading programs...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {!loading && !error && (
        <>
          {/* Centered dropdown */}
          <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'center' }}>
            <sl-select
              placeholder="Select Program..."
              value={selectedProgramId ?? ''}
              onSlChange={(e: CustomEvent) => {
                setSelectedProgramId((e.detail as any).value);
              }}
              style={{ width: '200px' }}
            >
              {Object.entries(programs).map(([id, title]) => (
                <sl-option key={id} value={id}>
                  {title}
                </sl-option>
              ))}
            </sl-select>
          </div>

          {/* Start/Stop buttons */}
          <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
            <sl-button
              variant="success"
              aria-label="Start Program"
              onClick={startProgram}
              disabled={!selectedProgramId}
            >
              <sl-icon name="play"></sl-icon>
            </sl-button>

            <sl-button
              variant="danger"
              aria-label="Stop Program"
              onClick={stopProgram}
              disabled={!selectedProgramId}
            >
              <sl-icon name="stop"></sl-icon>
            </sl-button>
          </div>
        </>
      )}

      {/* Footer */}
      <footer style={{ marginTop: 'auto', fontSize: '0.875rem', color: '#666' }}>
        Malmö Skyttegille Rotation Target {__APP_VERSION__}
      </footer>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
