import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "@shoelace-style/shoelace/dist/themes/light.css";
import { setBasePath } from "@shoelace-style/shoelace/dist/utilities/base-path.js";
import { registerIconLibrary } from "@shoelace-style/shoelace/dist/utilities/icon-library.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "./index.css";

declare const __APP_VERSION__: string;

setBasePath('/shoelace');

registerIconLibrary('default', {
  resolver: (name) => `/icons/${name}.svg`,
  mutator: (svg) => svg.setAttribute('fill', 'currentColor')
});

function App() {
  const [programs, setPrograms] = useState<string[]>([]);
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/programs')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch programs');
        return res.json();
      })
      .then(data => setPrograms(data.programs))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const startProgram = () => {
    if (selectedProgram) fetch(`/api/programs/${selectedProgram}/start`, { method: 'POST' });
  };

  const stopProgram = () => {
    if (selectedProgram) fetch(`/api/programs/${selectedProgram}/stop`, { method: 'POST' });
  };

  const turnTarget = () => {
    fetch('/api/target/turn', { method: 'POST' });
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',   // <-- CHANGED!
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

      {/* Turn target button */}
      <div style={{ marginBottom: '2rem' }}>
        <sl-button variant="primary" onClick={turnTarget}>
          Turn Target
        </sl-button>
      </div>

      {/* Program selection */}
      <h3>Programs</h3>

      {loading && <p>Loading programs...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          {programs.map(program => {
            const isSelected = selectedProgram === program;
            return (
              <div
                key={program}
                style={{
                  border: isSelected ? '3px solid black' : '3px solid transparent',
                  borderRadius: '8px',
                  padding: '0.5rem 1rem',
                  opacity: isSelected ? 1.0 : 0.5,
                  transition: 'opacity 0.3s, border 0.3s',
                }}
              >
                <sl-button
                  size="large"
                  variant="neutral"
                  onClick={() => setSelectedProgram(program)}
                >
                  {program}
                </sl-button>
              </div>
            );
          })}
        </div>
      )}

      {/* Start/Stop buttons */}
      {selectedProgram && (
        <div style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
            <sl-button variant="success" aria-label="Start Program" onClick={startProgram}>
              <sl-icon name="play"></sl-icon>
            </sl-button>
            <sl-button variant="danger" aria-label="Stop Program" onClick={stopProgram}>
              <sl-icon name="stop"></sl-icon>
            </sl-button>
          </div>
        </div>
      )}

      {/* Footer pushed to bottom */}
      <footer style={{ marginTop: 'auto', fontSize: '0.875rem', color: '#666' }}>
        Malmö Skyttegille Rotation Target {__APP_VERSION__}
      </footer>
    </div>

  );
}

render(<App />, document.getElementById('app')!);
