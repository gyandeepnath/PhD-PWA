/**
 * Self-paced rest break, offered after every N conditions (CONFIG.BREAK_EVERY_N_CONDITIONS) to
 * reduce boredom/fatigue accumulation over the long within-subjects session.
 *
 * Strictly neutral: it shows only how far through the sitting the participant is and an optional
 * elapsed-rest readout. It gives NO performance feedback or scores — that would differentially
 * change effort across conditions and confound the display manipulation. The participant continues
 * whenever they are ready (no forced timer), so the break never inflates the session unnecessarily.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { WavyBackground } from '@/components/WavyBackground';
import { now } from '@/lib/timing';

interface Props {
  /** Conditions completed so far in this sitting. */
  completed: number;
  /** Total conditions in this sitting. */
  total: number;
  onContinue: () => void;
  /** Researcher-facing slot (mid-session illuminance checkpoint). */
  children?: ReactNode;
}

export function BreakScreen({ completed, total, onContinue, children }: Props) {
  const [rested, setRested] = useState(0);
  useEffect(() => {
    const start = now();
    let raf = 0;
    const tick = () => {
      setRested(Math.floor((now() - start) / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const remaining = Math.max(0, total - completed);

  return (
    <div
      data-stage="BREAK_SCREEN"
      className="min-h-screen w-full bg-cream p-[6%] font-sans text-[#1a1a2e] animate-fade-in"
      style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 560, textAlign: 'center' }}>
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">Rest break</p>
        <h1 className="mt-2 font-serif text-4xl font-light">Take a short rest</h1>
        <p className="mt-4 font-lab text-sm leading-relaxed text-[#3a3a4a]">
          You’ve completed <strong>{completed} of {total}</strong> displays.{' '}
          {remaining > 0 ? <>Just <strong>{remaining}</strong> more to go.</> : null} Look away from the
          screen, blink, and relax your eyes for a moment. Continue whenever you’re ready.
        </p>
        <p className="mt-3 font-lab text-xs text-[#5a5a7a]">Rested for {rested}s</p>
      {children}

        <button
          onClick={onContinue}
          className="mt-8 rounded-xl px-8 py-3 font-lab text-sm text-white transition active:scale-95"
          style={{ background: '#1a1a2e', cursor: 'pointer' }}
        >
          I’m ready — continue →
        </button>
      </div>
    </div>
  );
}
