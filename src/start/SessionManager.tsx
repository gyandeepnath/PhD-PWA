/**
 * Researcher session console: lists in-progress and completed sessions, starts new ones, resumes
 * interrupted sessions, opens completed sessions in the dashboard, and manages a 30-day soft-delete
 * recycle bin (restore / permanent purge). Expired bin entries are auto-purged on mount.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  listSessions, listDeleted, softDeleteSession, restoreSession, purgeSession, purgeExpired,
  renameSession, sessionLabel, BIN_RETENTION_MS,
} from '@/storage/gather';
import { loadResume } from '@/storage/sessionPersistence';
import { WavyBackground } from '@/components/WavyBackground';
import type { SessionRecord } from '@/storage/types';

interface Props {
  onNew: () => void;
  onResume: (sessionId: string, nextStepIndex: number) => void;
  onOpen: (sessionId: string) => void;
  onHome: () => void;
}

export function SessionManager({ onNew, onResume, onOpen, onHome }: Props) {
  const [active, setActive] = useState<SessionRecord[]>([]);
  const [bin, setBin] = useState<SessionRecord[]>([]);
  const [showBin, setShowBin] = useState(false);
  const resume = loadResume();

  const refresh = useCallback(async () => {
    await purgeExpired();
    setActive(await listSessions());
    setBin(await listDeleted());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inProgress = active.filter((s) => s.status === 'in_progress');
  const completed = active.filter((s) => s.status === 'complete');

  const rename = async (s: SessionRecord) => {
    const label = window.prompt('Rename session', sessionLabel(s));
    if (label != null) {
      await renameSession(s.session_id, label);
      await refresh();
    }
  };
  const del = async (s: SessionRecord) => {
    await softDeleteSession(s.session_id);
    await refresh();
  };
  const restore = async (s: SessionRecord) => {
    await restoreSession(s.session_id);
    await refresh();
  };
  const purge = async (s: SessionRecord) => {
    if (window.confirm(`Permanently delete ${sessionLabel(s)} and all its data? This cannot be undone.`)) {
      await purgeSession(s.session_id);
      await refresh();
    }
  };

  return (
    <div className="min-h-screen w-full bg-cream font-sans text-[#1a1a2e] animate-fade-in" style={{ position: 'relative', padding: '3% 4%' }}>
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">VisuLab · Research Platform</p>
            <h1 className="font-serif text-3xl font-light" style={{ marginTop: 4 }}>Session Manager</h1>
          </div>
          <button onClick={onHome} className="font-lab text-sm" style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #d8d4cc', background: '#fff', cursor: 'pointer' }}>← Home</button>
        </div>

        <button onClick={onNew} className="mt-5 w-full rounded-xl py-4 font-lab text-sm uppercase tracking-wide text-white transition active:scale-95" style={{ background: '#1a1a2e' }}>
          + New Session
        </button>

        {resume && inProgress.some((s) => s.session_id === resume.sessionId) && (
          <div style={{ marginTop: 14, background: '#eef3ff', border: '1px solid #cdd8f0', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-lab text-sm">Resume in-progress session (next condition {resume.nextStepIndex + 1}/8)</span>
            <button onClick={() => onResume(resume.sessionId, resume.nextStepIndex)} className="font-lab text-sm text-white" style={{ background: '#4f8ef7', border: 'none', borderRadius: 10, padding: '8px 16px', cursor: 'pointer' }}>Resume →</button>
          </div>
        )}

        <Section title={`In progress (${inProgress.length})`}>
          {inProgress.map((s) => (
            <Row key={s.session_id} s={s}>
              {resume?.sessionId === s.session_id && (
                <Btn onClick={() => onResume(s.session_id, resume.nextStepIndex)} color="#4f8ef7">Resume</Btn>
              )}
              <Btn onClick={() => del(s)} color="#e64c4c" outline>Delete</Btn>
            </Row>
          ))}
          {inProgress.length === 0 && <Empty>No sessions in progress.</Empty>}
        </Section>

        <Section title={`Completed (${completed.length})`}>
          {completed.map((s) => (
            <Row key={s.session_id} s={s}>
              <Btn onClick={() => onOpen(s.session_id)} color="#1a1a2e">Open</Btn>
              <Btn onClick={() => rename(s)} color="#5a5a7a" outline>Rename</Btn>
              <Btn onClick={() => del(s)} color="#e64c4c" outline>Delete</Btn>
            </Row>
          ))}
          {completed.length === 0 && <Empty>No completed sessions yet.</Empty>}
        </Section>

        <div style={{ marginTop: 18 }}>
          <button onClick={() => setShowBin((b) => !b)} className="font-lab text-sm text-[#5a5a7a]" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            {showBin ? '▾' : '▸'} Recycle bin ({bin.length}) · auto-purged after 30 days
          </button>
          {showBin && (
            <div style={{ marginTop: 8 }}>
              {bin.map((s) => {
                const daysLeft = Math.ceil((BIN_RETENTION_MS - (Date.now() - (s.deleted_at ?? 0))) / 86400000);
                return (
                  <Row key={s.session_id} s={s} note={`${daysLeft}d left`}>
                    <Btn onClick={() => restore(s)} color="#22c97a" outline>Restore</Btn>
                    <Btn onClick={() => purge(s)} color="#e64c4c">Purge</Btn>
                  </Row>
                );
              })}
              {bin.length === 0 && <Empty>Bin is empty.</Empty>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <p className="font-lab text-xs uppercase tracking-wide text-[#9a968e]" style={{ marginBottom: 8 }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}
function Row({ s, children, note }: { s: SessionRecord; children: React.ReactNode; note?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid #e5e2dc', borderRadius: 12, padding: '12px 14px' }}>
      <div>
        <div className="font-lab text-sm">{sessionLabel(s)}</div>
        <div className="font-lab" style={{ fontSize: 11, color: '#9a968e' }}>
          {new Date(s.session_start_time).toLocaleString()}{note ? ` · ${note}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>{children}</div>
    </div>
  );
}
function Btn({ onClick, color, outline, children }: { onClick: () => void; color: string; outline?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="font-lab text-sm" style={{ padding: '7px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${color}`, background: outline ? '#fff' : color, color: outline ? color : '#fff' }}>
      {children}
    </button>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="font-lab" style={{ fontSize: 12, color: '#b8b4ac' }}>{children}</p>;
}
