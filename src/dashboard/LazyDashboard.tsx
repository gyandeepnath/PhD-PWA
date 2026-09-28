/**
 * Lazy wrapper around the researcher Dashboard. The dashboard pulls in Recharts (~525 kB), which
 * the participant-facing flow never needs — code-splitting it here keeps it out of the initial
 * bundle and only fetches it when the dashboard is actually opened.
 */
import { lazy, Suspense } from 'react';
import { NavChip } from '@/components/NavChip';

const Dashboard = lazy(() => import('./Dashboard').then((m) => ({ default: m.Dashboard })));

/**
 * The way back to the session manager is drawn HERE, outside the lazy boundary, so it is on screen
 * while the chunk loads and whichever route opened the dashboard. There used to be two copies of it,
 * one in App.tsx and one in Experiment.tsx, in two different fonts, sizes and borders.
 */
export function LazyDashboard({ onBack, ...props }: { initialSessionId?: string; onBack: () => void }) {
  return (
    <div className="screen w-full" style={{ position: 'relative' }}>
      <Suspense
        fallback={
          <div className="screen w-full bg-cream font-sans text-[#1a1a2e]" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p className="font-sans text-[15px] text-[#4a4a60]">Loading dashboard…</p>
          </div>
        }
      >
        <Dashboard {...props} />
      </Suspense>
      <NavChip label="← Back to sessions" onClick={onBack} testId="nav-sessions" />
    </div>
  );
}
