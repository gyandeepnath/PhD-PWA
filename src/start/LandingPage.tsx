/**
 * Intro / landing screen (researcher entry point). Two-column landscape layout in the cream theme,
 * a frosted "Study Overview" card, and an entry button into the session console.
 */
import { VisuLabLogo } from '@/components/VisuLabLogo';
import { BuildInfo } from '@/components/BuildInfo';
import { DeviceBox } from '@/components/DeviceBox';
import { CONDITIONS } from '@/experiment/conditions';
import { CONFIG } from '@/experiment/config';

export function LandingPage({ onEnter }: { onEnter: () => void }) {
  return (
    /*
     * .screen with its own scroll, not min-h-screen: 100vh is not the scaled root's height, so the page
     * centred 50-80 px above the middle of the tablet and could not scroll. The bottom padding makes
     * room for the update banner while it shows (--vl-banner-h, set by UpdateBanner), which used to
     * sit over the build stamp. Centred by margin:auto on the two columns so neither can lose its top.
     */
    <div
      className="screen scrollable w-full bg-cream font-sans text-[#1a1a2e] animate-fade-in"
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: '24px 7% calc(16px + var(--vl-banner-h)) 8%' }}
    >
      <div style={{ flex: '1 0 auto', display: 'flex', gap: '6%' }}>
      {/* Type on the scaled canvas: 13 px and 11 px here arrived at about 11 and 9 px on the tablet,
          the credit line in #9a968e at 2.8:1. Now 17 / 15 px and ≥4.5:1. */}
      <div style={{ flex: 1, margin: 'auto 0' }}>
        <p className="font-sans text-sm font-medium uppercase tracking-wide text-[#4a4a60]">Research Platform</p>
        <h1 style={{ marginTop: 14, lineHeight: 1 }}>
          <VisuLabLogo size={72} />
        </h1>
        <div style={{ height: 2, width: 64, background: '#1a1a2e', opacity: 0.5, margin: '22px 0' }} />
        <p className="font-sans" style={{ fontSize: 18, lineHeight: 1.65, color: '#3a3a4a', maxWidth: 520 }}>
          A tablet platform for visual-ergonomics experiments. Each session measures reading,
          attention and reaction performance across {CONDITIONS.length} display conditions, with webcam-based
          blink/gaze estimation and validated fatigue questionnaires.
        </p>
        <p className="font-sans" style={{ fontSize: 15, color: '#4a4a60', marginTop: 28 }}>
          Experimental logic by Gyandeep Nath
        </p>
      </div>

      <div
        style={{
          flexBasis: 420, background: '#ffffff', border: '1px solid #e5e2dc', borderRadius: 20, padding: 28,
          margin: 'auto 0',
        }}
      >
        <p className="font-sans text-sm font-medium uppercase tracking-wide text-[#4a4a60]">Study Overview</p>
        <div style={{ marginTop: 16 }}>
          {[
            /*
             * Derived, not stated. This read "2 polarity x 4 colour" beside a condition count that
             * already derived from the table — so it rendered "10 (2 polarity x 4 colour)", and
             * 2 x 4 is 8. The text predates GREEN being added to the original four-colour set and
             * was never updated, which made the study overview shown to operators contradict itself.
             */
            ['Conditions', `${CONDITIONS.length} (${new Set(CONDITIONS.map((c) => c.polarity)).size} polarity × ${new Set(CONDITIONS.map((c) => c.colorName)).size} colour)`],
            ['Design', 'Within-subjects, Williams Latin square'],
            ['Duration', `${CONFIG.SINGLE_SITTING_DURATION} per sitting`],
            ['Tasks', 'Reading · Search · Go/No-Go'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: '1px solid #e5e2dc' }}>
              <span className="font-sans" style={{ fontSize: 15, color: '#4a4a60' }}>{k}</span>
              <span className="font-sans" style={{ fontSize: 15, textAlign: 'right', color: '#1a1a2e' }}>{v}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onEnter}
          className="mt-6 w-full rounded-xl py-4 font-sans text-base font-medium text-white transition active:scale-95"
          style={{ background: '#1a1a2e' }}
        >
          Enter Research Console →
        </button>
      </div>
      </div>
      {/*
        Which build, and on what screen. The build line used to be a fixed stamp in the corner reading
        "v2.1.0 · <hash>", which never changed between deployments as far as anyone could tell; the
        device line did not exist, so the viewport every layout assumed could not be checked from the
        tablet (Round 74). In the page's flow, above the update notice's reserved space, not under it.
      */}
      <footer style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <BuildInfo auto />
        <DeviceBox compact />
      </footer>
    </div>
  );
}
