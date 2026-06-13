/** Thin top progress bar driven by the stage machine. */
interface Props {
  percent: number;
  label?: string;
}

export function ExperimentProgress({ percent, label }: Props) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 }}>
      <div style={{ height: 4, background: '#e5e2dc' }}>
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            background: '#1a1a2e',
            transition: 'width 0.3s ease-out',
          }}
        />
      </div>
      {label && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            fontFamily: '"DM Mono", monospace',
            fontSize: 11,
            color: '#5a5a7a',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
