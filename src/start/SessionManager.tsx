/**
 * Researcher session console: lists in-progress and completed sessions, starts new ones, resumes
 * interrupted sessions, opens completed sessions in the dashboard, and manages a 30-day soft-delete
 * recycle bin (restore / permanent purge). Expired bin entries are auto-purged on mount.
 */
import { useCallback, useEffect, useState, useRef } from 'react';
import {
  revokeMediaGrant,
  listSessions, listDeleted, softDeleteSession, restoreSession, purgeSession, purgeExpired,
  renameSession, sessionLabel, BIN_RETENTION_MS, MAX_DISPLAY_LABEL,
} from '@/storage/gather';
import { listResumable, type ResumePointer } from '@/storage/sessionPersistence';
import { parseSessionBackup, importSessionBackup } from '@/storage/backup';
import { WavyBackground } from '@/components/WavyBackground';
import type { SessionRecord } from '@/storage/types';

interface Props {
  onNew: () => void;
  onResume: (sessionId: string, nextStepIndex: number, reachedLoop: boolean) => void;
  onOpen: (sessionId: string) => void;
  onHome: () => void;
}

export function SessionManager({ onNew, onResume, onOpen, onHome }: Props) {
  const [active, setActive] = useState<SessionRecord[]>([]);
  const [bin, setBin] = useState<SessionRecord[]>([]);
  const [showBin, setShowBin] = useState(false);
  /** What the auto-purge declined to destroy, and why. */
  const [binNotice, setBinNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * One pointer per in-progress session, read from IndexedDB rather than from a single localStorage
   * key. With one key, starting a second session made the first unresumable while all of its data
   * sat on the device — and two sittings are in progress at once whenever a participant is part-way
   * through and the next is started.
   */
  const [resumable, setResumable] = useState<Record<string, ResumePointer>>({});

  const refresh = useCallback(async () => {
    /**
     * The bin reports what it declined to destroy as well as what it destroyed. It used to discard
     * the count entirely, so a session it purged — or refused to purge — left no trace anywhere.
     */
    const purge = await purgeExpired();
    /*
     * BOTH halves are reported, which the comment above has always claimed and the code did not do.
     *
     * `purged` was computed and discarded, so a session the timer permanently destroyed vanished
     * with no notice anywhere — the operator opens the manager, and a participant's sitting is
     * simply gone. Retention is a warning; destruction is a fact the operator has to be told, not
     * least because it is the one thing here that cannot be undone.
     */
    const parts: string[] = [];
    if (purge.purged > 0) {
      parts.push(
        `${purge.purged} session(s) past the 30-day window were PERMANENTLY DELETED just now. `
        + 'This cannot be undone. They had been confirmed as exported.',
      );
    }
    if (purge.retained.length) {
      parts.push(
        `${purge.retained.length} session(s) are past the 30-day window but were NOT auto-deleted:\n`
        + purge.retained.map((r) => `  ${r.session_id} — ${r.reason}`).join('\n')
        + '\n\nPurge them from the bin deliberately once you are sure they are safe to lose.',
      );
    }
    setBinNotice(parts.length ? parts.join('\n\n') : null);
    setActive(await listSessions());
    setBin(await listDeleted());
    const list = await listResumable();
    setResumable(Object.fromEntries(list.map((r) => [r.sessionId, r])));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inProgress = active.filter((s) => s.status === 'in_progress');
  const completed = active.filter((s) => s.status === 'complete');

  // The banner offers the most recently touched one; every other in-progress session still gets its
  // own Resume button on its own row, so none of them is stranded.
  const mostRecent = inProgress
    .filter((s) => resumable[s.session_id])
    .map((s) => ({ session: s, pointer: resumable[s.session_id] }))
    .sort((a, b) => b.pointer.savedAt - a.pointer.savedAt)[0];

  /**
   * Restore from the backup_*.json written into every export. Deliberately noisy: it reports what
   * it wrote, surfaces every warning, and never overwrites a session already on the device without
   * the operator saying so, because the copy already here may be the good one.
   */
  const onImportFile = async (file: File) => {
    setImporting(true);
    try {
      const parsed = parseSessionBackup(await file.text());
      if (!parsed.ok || !parsed.backup) {
        window.alert(`Could not restore this file.\n\n${parsed.error ?? 'Unknown problem.'}`);
        return;
      }
      let result = await importSessionBackup(parsed.backup);
      if (!result.ok) {
        const proceed = window.confirm(
          `${result.error}\n\nOverwrite the copy on this device with the backup?`,
        );
        if (!proceed) return;
        result = await importSessionBackup(parsed.backup, 'overwrite');
      }
      if (!result.ok) {
        window.alert(`Restore failed.\n\n${result.error ?? 'Unknown problem.'}`);
        return;
      }
      const rows = Object.entries(result.written)
        .filter(([, n]) => n > 0)
        .map(([store, n]) => `  ${store}: ${n}`)
        .join('\n');
      const warn = parsed.warnings.length ? `\n\nNote:\n${parsed.warnings.map((w) => `  ${w}`).join('\n')}` : '';
      // A counterbalance collision is not a warning about the file; it is a fact about this
      // device that compromises two participants' condition orders, so it leads.
      const clash = result.collision ? `\n\nCOUNTERBALANCE PROBLEM\n  ${result.collision}` : '';
      window.alert(`Session restored.${clash}\n\nRows written:\n${rows}${warn}`);
      await refresh();
    } catch (err) {
      window.alert(`Could not read the file.\n\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  /**
   * Label a sitting so it can be found in this list.
   *
   * The old prompt said only "Rename session", which invites a participant's name — and the whole
   * session record used to be written into the exported JSON and the backup, so that name left the
   * device with a bundle the protocol treats as de-identified. The export now strips the label
   * (gather.ts, sessionForExport), and the wording here says what the field is for so the operator
   * is not misled into treating it as a notes field in the first place.
   */
  const rename = async (s: SessionRecord) => {
    const label = window.prompt(
      `A short reminder to find this sitting by, on this tablet only (max ${MAX_DISPLAY_LABEL} characters).\n\n`
      + 'Do NOT enter the participant\'s name or any identifying detail. The label is not exported '
      + 'and is not part of the data; the participant code is what identifies the sitting.\n\n'
      + 'Leave empty to go back to the participant code.',
      sessionLabel(s),
    );
    if (label != null) {
      await renameSession(s.session_id, label);
      await refresh();
    }
  };
  /**
   * Destroy the recordings covered by one media grant, and record the withdrawal.
   *
   * This is the operation three documents promise and none implemented — including the synopsis
   * §3.10 submitted to the ethics committee, which states retained media are "deletable
   * independently of" the research dataset. Until this control existed, the only way to remove a
   * photograph or a video clip was Purge, which also destroys the ten condition rows, the reaction
   * trials, both questionnaires and the participant record. A participant who wanted their
   * recordings gone while remaining enrolled could not be accommodated.
   *
   * Irreversible and confirmed as such: the bin does not cover it, because the point of the
   * operation is that the bytes are gone.
   */
  const revokeMedia = async (s: SessionRecord, grant: 'setup_photos' | 'annotation_video') => {
    const what = grant === 'annotation_video' ? 'reading video clips' : 'setup photographs';
    const label = sessionLabel(s);
    if (!window.confirm(
      `Delete the ${what} for ${label}, and record that the participant withdrew that permission?\n\n`
      + 'The measurements from this session are KEPT — only the recordings are destroyed.\n\n'
      + 'This cannot be undone. The recycle bin does not cover it.',
    )) return;
    const removed = await revokeMediaGrant(s.session_id, grant);
    await refresh();
    window.alert(
      removed === 0
        ? `No ${what} were stored for ${label}. The permission is now recorded as withdrawn.`
        : `${removed} file(s) destroyed. The permission is recorded as withdrawn, so no further `
          + `${what} can be captured or exported for this session.`,
    );
  };

  const del = async (s: SessionRecord) => {
    // Confirmed, like purge is. Delete sits next to Resume and Export on a row of small buttons, on
    // a touch screen, operated by someone standing next to a participant. The bin makes it
    // recoverable for thirty days, which is a reason to keep the wording calm — not a reason to
    // make a destructive action a single unconfirmed tap.
    const label = sessionLabel(s);
    const extra = s.status === 'in_progress'
      ? '\n\nThis session is still IN PROGRESS. Deleting it ends it; it cannot be resumed from the bin.'
      : '';
    if (!window.confirm(`Move ${label} to the recycle bin?${extra}\n\nIt is recoverable for ${BIN_RETENTION_MS / 86400000} days.`)) return;
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

        {/* Recovery path. A tablet that is wiped or replaced takes every unexported session with
            it, and the participants cannot be asked to sit the protocol again, so the backup file
            written into every export must be importable on any device. */}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          data-testid="import-backup-input"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onImportFile(f); }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={importing}
          data-testid="import-backup"
          className="mt-2 w-full rounded-xl py-3 font-lab text-sm transition active:scale-95"
          style={{ background: '#fff', border: '1px solid #d8d4cc', cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1 }}
        >
          {importing ? 'Restoring…' : 'Restore session from backup file'}
        </button>

        {mostRecent && (
          <div style={{ marginTop: 14, background: '#eef3ff', border: '1px solid #cdd8f0', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-lab text-sm">
              {/* A session interrupted during setup has no condition pointer; saying "next
                  condition 1/10" for it implied progress that had not happened, and the resume
                  dropped the participant straight into the reading task. */}
              Resume {sessionLabel(mostRecent.session)}{' '}
              {mostRecent.pointer.reachedLoop
                ? `(next condition ${mostRecent.pointer.nextStepIndex + 1}/${mostRecent.session.conditions_per_session})`
                : '(interrupted during setup — setup will be completed first)'}
              {Object.keys(resumable).length > 1 && ` · ${Object.keys(resumable).length} sessions in progress`}
            </span>
            <button onClick={() => onResume(mostRecent.pointer.sessionId, mostRecent.pointer.nextStepIndex, mostRecent.pointer.reachedLoop === true)} className="font-lab text-sm text-white" style={{ background: '#4f8ef7', border: 'none', borderRadius: 10, padding: '8px 16px', cursor: 'pointer' }}>Resume →</button>
          </div>
        )}

        <Section title={`In progress (${inProgress.length})`}>
          {inProgress.map((s) => (
            <Row key={s.session_id} s={s}>
              {resumable[s.session_id] && (
                <Btn onClick={() => onResume(s.session_id, resumable[s.session_id].nextStepIndex, resumable[s.session_id].reachedLoop === true)} color="#4f8ef7">Resume</Btn>
              )}
              {/* A participant may withdraw at any point, and the operator manual tells the
                  operator to export what exists when they do. Without this the dashboard — and so
                  the only export path — was reachable for COMPLETED sessions only, and a withdrawn
                  sitting could not be got off the tablet at all. The export declares its own
                  incompleteness, so allowing it here cannot silently contaminate the analysis. */}
              <Btn onClick={() => onOpen(s.session_id)} color="#1a1a2e" outline>Export</Btn>
              <MediaControls s={s} onRevoke={revokeMedia} />
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
              <MediaControls s={s} onRevoke={revokeMedia} />
              <Btn onClick={() => del(s)} color="#e64c4c" outline>Delete</Btn>
            </Row>
          ))}
          {completed.length === 0 && <Empty>No completed sessions yet.</Empty>}
        </Section>

        <div style={{ marginTop: 18 }}>
          {binNotice && (
            <p className="font-lab text-sm" style={{ marginBottom: 8, background: '#fff6e5', border: '1px solid #f0d8a8', borderRadius: 10, padding: 12, whiteSpace: 'pre-wrap' }}>
              {binNotice}
            </p>
          )}
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
/**
 * Media-withdrawal controls for one session.
 *
 * Rendered only for grants that are currently in force. A control offered against an already
 * withdrawn grant would invite an operator to "delete" recordings that are already gone and imply
 * the withdrawal had not taken — and a grant that was never given has nothing to withdraw.
 */
function MediaControls({ s, onRevoke }: {
  s: SessionRecord;
  onRevoke: (s: SessionRecord, grant: 'setup_photos' | 'annotation_video') => void;
}) {
  const c = s.media_consent;
  return (
    <>
      {c?.setup_photos === true && (
        <Btn onClick={() => onRevoke(s, 'setup_photos')} color="#b8860b" outline>Delete photos</Btn>
      )}
      {c?.annotation_video === true && (
        <Btn onClick={() => onRevoke(s, 'annotation_video')} color="#b8860b" outline>Delete video</Btn>
      )}
    </>
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
