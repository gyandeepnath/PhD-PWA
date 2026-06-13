/**
 * Subtle animated wave backdrop for non-task screens (preserved from the original design).
 * Pure CSS/SVG, very low opacity, pointer-events none so it never interferes with the UI.
 */
interface Props {
  color?: string;
  opacity?: number;
}

export function WavyBackground({ color = '#1a1a2e', opacity = 0.055 }: Props) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity,
        zIndex: 0,
      }}
    >
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 1200 800">
        {[0, 1, 2, 3].map((i) => (
          <path
            key={i}
            d={`M0 ${200 + i * 140} C 300 ${120 + i * 140}, 900 ${280 + i * 140}, 1200 ${200 + i * 140}`}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
          >
            <animate
              attributeName="d"
              dur={`${10 + i * 3}s`}
              repeatCount="indefinite"
              values={`M0 ${200 + i * 140} C 300 ${120 + i * 140}, 900 ${280 + i * 140}, 1200 ${200 + i * 140};M0 ${200 + i * 140} C 300 ${280 + i * 140}, 900 ${120 + i * 140}, 1200 ${200 + i * 140};M0 ${200 + i * 140} C 300 ${120 + i * 140}, 900 ${280 + i * 140}, 1200 ${200 + i * 140}`}
            />
          </path>
        ))}
      </svg>
    </div>
  );
}
