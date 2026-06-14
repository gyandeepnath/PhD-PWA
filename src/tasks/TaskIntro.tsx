/**
 * Full-screen task instruction card shown before each task so the participant always knows what to
 * do. Themed to the active condition's colours (or a neutral cream default for setup-level intros).
 */
interface Props {
  eyebrow: string;
  title: string;
  lines: string[];
  buttonLabel?: string;
  background?: string;
  text?: string;
  onBegin: () => void;
}

export function TaskIntro({
  eyebrow,
  title,
  lines,
  buttonLabel = 'Begin →',
  background = '#F8F7F5',
  text = '#1a1a2e',
  onBegin,
}: Props) {
  const onLightTheme = background.toUpperCase() === '#F8F7F5';
  return (
    <div
      className="min-h-screen w-full animate-fade-in"
      style={{ background, color: text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8%' }}
    >
      <div style={{ maxWidth: 620, textAlign: 'center' }}>
        <p style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.6 }}>
          {eyebrow}
        </p>
        <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 300, fontSize: 36, margin: '12px 0 18px' }}>{title}</h1>
        {lines.map((l, i) => (
          <p key={i} style={{ fontFamily: 'Roboto, sans-serif', fontSize: 17, lineHeight: 1.6, opacity: 0.9, marginBottom: 10 }}>
            {l}
          </p>
        ))}
        <button
          onClick={onBegin}
          style={{
            marginTop: 24,
            background: text,
            color: background,
            border: 'none',
            borderRadius: 14,
            padding: '16px 40px',
            fontFamily: '"DM Mono", monospace',
            fontSize: 16,
            cursor: 'pointer',
            boxShadow: onLightTheme ? '0 2px 10px rgba(0,0,0,0.12)' : 'none',
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
