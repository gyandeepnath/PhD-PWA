import { useState } from 'react';
import Experiment from '@/experiment/Experiment';
import { LandingPage } from '@/start/LandingPage';
import { SessionManager } from '@/start/SessionManager';
import { LazyDashboard as Dashboard } from '@/dashboard/LazyDashboard';
import { UpdateBanner, BuildStamp, E2EBanner } from '@/components/UpdateBanner';

/**
 * Top-level shell / router. Landing → session manager → (new or resumed experiment) → back to
 * manager. Completed sessions open directly in the dashboard. The experiment owns the stage
 * machine; the shell only decides which top-level view is active.
 */
type View =
  | { mode: 'landing' }
  | { mode: 'manager' }
  | { mode: 'experiment'; resume?: { sessionId: string; nextStepIndex: number; reachedLoop?: boolean } }
  | { mode: 'dashboard'; sessionId: string };

export default function App() {
  const [view, setView] = useState<View>({ mode: 'landing' });
  const toManager = () => setView({ mode: 'manager' });

  // Rendered on EVERY view, not just the between-sessions ones: the whole point is that a tablet
  // left on a bookmarked ?e2e URL looks exactly like a real one from the first screen to the last.
  return (
    <>
      <E2EBanner />
      {renderView(view, setView, toManager)}
    </>
  );
}

function renderView(
  view: View,
  setView: (v: View) => void,
  toManager: () => void,
) {
  switch (view.mode) {
    case 'landing':
      return (
        <>
          <LandingPage onEnter={toManager} />
          {/* Between-sessions screens only: applying an update reloads the app, which would cost a
              sitting if it happened mid-protocol. */}
          <UpdateBanner />
          <BuildStamp />
        </>
      );
    case 'manager':
      return (
        <>
        <SessionManager
          onNew={() => setView({ mode: 'experiment' })}
          onResume={(sessionId, nextStepIndex, reachedLoop) => setView({ mode: 'experiment', resume: { sessionId, nextStepIndex, reachedLoop } })}
          onOpen={(sessionId) => setView({ mode: 'dashboard', sessionId })}
          onHome={() => setView({ mode: 'landing' })}
        />
        <UpdateBanner />
        </>
      );
    case 'experiment':
      // Remount per entry (key) so a fresh or resumed run starts from clean component state.
      return (
        <Experiment
          key={view.resume ? `resume-${view.resume.sessionId}` : 'new'}
          resume={view.resume}
          onExit={toManager}
        />
      );
    case 'dashboard':
      return (
        <div style={{ height: '100%' }}>
          <Dashboard initialSessionId={view.sessionId} />
          <button
            onClick={toManager}
            className="font-lab text-sm"
            style={{ position: 'fixed', top: 10, left: 12, zIndex: 50, padding: '6px 12px', borderRadius: 8, border: '1px solid #d8d4cc', background: '#fff', cursor: 'pointer' }}
          >
            ← Sessions
          </button>
        </div>
      );
  }
}
