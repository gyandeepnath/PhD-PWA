/**
 * Intro / landing screen (researcher entry point). Two-column landscape layout in the cream theme,
 * a frosted "Study Overview" card, and an entry button into the session console.
 */
import { WavyBackground } from '@/components/WavyBackground';
import { CONDITIONS } from '@/experiment/conditions';

export function LandingPage({ onEnter }: { onEnter: () => void }) {
  return (
    <div
      className="min-h-screen w-full bg-cream font-sans text-[#1a1a2e] animate-fade-in"
      style={{ position: 'relative', display: 'flex', alignItems: 'center', padding: '0 7% 0 8%', gap: '6%' }}
    >
      <WavyBackground opacity={0.055} />
      <div style={{ position: 'relative', zIndex: 1, flex: 1 }}>
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">VisuLab · Research Platform</p>
        <h1 className="font-serif font-light" style={{ fontSize: 'clamp(48px, 5.5vw, 88px)', lineHeight: 1.05, marginTop: 10 }}>
          VisuLab
        </h1>
        <div style={{ height: 2, width: 64, background: '#1a1a2e', opacity: 0.5, margin: '18px 0' }} />
        <p className="font-lab" style={{ fontSize: 13, lineHeight: 1.85, color: '#5a5a7a', maxWidth: 460 }}>
          A tablet platform for visual-ergonomics experiments. Each session measures reading,
          attention and reaction performance across eight display conditions, with webcam-based
          blink/gaze estimation and validated fatigue questionnaires.
        </p>
        <p className="font-lab" style={{ fontSize: 11, color: '#9a968e', marginTop: 28 }}>
          Experimental logic by Gyandeep Nath
        </p>
      </div>

      <div
        style={{
          position: 'relative', zIndex: 1, flexBasis: 360, background: 'rgba(255,255,255,0.55)',
          backdropFilter: 'blur(8px)', border: '1px solid #e5e2dc', borderRadius: 20, padding: 28,
        }}
      >
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">Study Overview</p>
        <div style={{ marginTop: 16 }}>
          {[
            ['Conditions', `${CONDITIONS.length} (2 polarity × 4 colour)`],
            ['Design', 'Within-subjects, Williams Latin square'],
            ['Duration', '~60–90 min'],
            ['Tasks', 'Reading · Search · Flanker RT'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #e5e2dc' }}>
              <span className="font-lab" style={{ fontSize: 12, color: '#5a5a7a' }}>{k}</span>
              <span className="font-lab" style={{ fontSize: 12, textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onEnter}
          className="mt-6 w-full rounded-xl py-3 font-lab text-sm text-white transition active:scale-95"
          style={{ background: '#1a1a2e' }}
        >
          Enter Research Console →
        </button>
      </div>
    </div>
  );
}
