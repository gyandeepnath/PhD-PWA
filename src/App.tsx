import { useState } from 'react';
import Experiment from '@/experiment/Experiment';
import { LandingPage } from '@/start/LandingPage';
import { SessionManager } from '@/start/SessionManager';
import { LazyDashboard as Dashboard } from '@/dashboard/LazyDashboard';

/**
 * Top-level shell / router. Landing → session manager → (new or resumed experiment) → back to
 * manager. Completed sessions open directly in the dashboard. The experiment owns the stage
 * machine; the shell only decides which top-level view is active.
 */
type View =
  | { mode: 'landing' }
  | { mode: 'manager' }
  | { mode: 'experiment'; resume?: { sessionId: string; nextStepIndex: number } }
  | { mode: 'dashboard'; sessionId: string };

export default function App() {
  const [view, setView] = useState<View>({ mode: 'landing' });
  const toManager = () => setView({ mode: 'manager' });

  switch (view.mode) {
    case 'landing':
      return <LandingPage onEnter={toManager} />;
    case 'manager':
      return (
        <SessionManager
          onNew={() => setView({ mode: 'experiment' })}
          onResume={(sessionId, nextStepIndex) => setView({ mode: 'experiment', resume: { sessionId, nextStepIndex } })}
          onOpen={(sessionId) => setView({ mode: 'dashboard', sessionId })}
          onHome={() => setView({ mode: 'landing' })}
        />
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
