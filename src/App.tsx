import { useEffect, useState } from 'react';
import { refitScale } from '@/lib/viewportScale';
import { useSystemBack } from '@/lib/systemBack';
import Experiment from '@/experiment/Experiment';
import { LandingPage } from '@/start/LandingPage';
import { SessionManager } from '@/start/SessionManager';
import { LazyDashboard as Dashboard } from '@/dashboard/LazyDashboard';
import { UpdateBanner, E2EBanner } from '@/components/UpdateBanner';

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
  // Every change of view is a screen boundary outside any stimulus: re-measure the screen, so a
  // scale that locked small (see viewportScale.ts) comes back instead of lasting the whole day.
  useEffect(() => { if (view.mode !== 'experiment') refitScale(); }, [view]);
  /*
   * The system Back gesture never leaves the app from inside it (lib/systemBack.ts, Round 87, audit 86
   * F6). On every view but the landing page it is claimed here, underneath everything: where a screen
   * draws its top-left chip, Back is that chip; where it draws none — a procedure running, the reaction
   * trials, the thank-you screen — Back does nothing. The landing page leaves it to the browser.
   */
  useSystemBack('screen', null, view.mode !== 'landing');

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
      // The way back is the shared NavChip, drawn by LazyDashboard for both routes into it.
      return <Dashboard initialSessionId={view.sessionId} onBack={toManager} />;
  }
}
