/**
 * Lazy wrapper around the researcher Dashboard. The dashboard pulls in Recharts (~525 kB), which
 * the participant-facing flow never needs — code-splitting it here keeps it out of the initial
 * bundle and only fetches it when the dashboard is actually opened.
 */
import { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('./Dashboard').then((m) => ({ default: m.Dashboard })));

export function LazyDashboard(props: { initialSessionId?: string }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full bg-cream font-sans text-[#1a1a2e]" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p className="font-sans text-[15px] text-[#4a4a60]">Loading dashboard…</p>
        </div>
      }
    >
      <Dashboard {...props} />
    </Suspense>
  );
}
