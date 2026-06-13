import { CONDITIONS } from '@/experiment/conditions';
import { sessionPlan } from '@/experiment/counterbalance';
import { APP_VERSION, GIT_HASH } from '@/lib/env';

/**
 * Placeholder shell for Phase 0. The real stage machine, start panel, tasks, tracking,
 * dashboard and storage are built in subsequent phases. This renders enough to verify the
 * theme, fonts, scaling, and the foundational counterbalancing/contrast logic end-to-end.
 */
export default function App() {
  const plan = sessionPlan(1);
  return (
    <div className="min-h-screen w-full bg-cream p-[6%] font-sans text-[#1a1a2e] animate-fade-in">
      <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">
        VisuLab · Research Platform
      </p>
      <h1 className="mt-2 font-serif text-5xl font-light">VisuLab</h1>
      <div className="mt-1 h-px w-16 bg-[#1a1a2e]/40" />
      <p className="mt-4 font-lab text-[13px] leading-relaxed text-[#5a5a7a]">
        Reconstructed source · build {APP_VERSION} ({GIT_HASH})
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3" style={{ maxWidth: 760 }}>
        {CONDITIONS.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-[#e5e2dc] p-3"
            style={{ background: c.background, color: c.text }}
          >
            <div className="font-lab text-sm">
              {c.label} · {c.polarity} · {c.colorName}
            </div>
            <div className="font-lab text-xs opacity-80">
              WCAG {c.wcag_contrast_ratio}:1 ({c.wcag_level}
              {c.below_wcag_aa ? ' — below AA' : ''})
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 font-lab text-xs text-[#5a5a7a]">
        Participant #1 plan (condition → passage):{' '}
        {plan.map((s) => `${CONDITIONS[s.conditionIndex].label}→P${s.passageIndex}`).join('  ')}
      </p>
    </div>
  );
}
