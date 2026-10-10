import { useRef } from 'react';
export function Switch({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const start = useRef<number | null>(null),
    skipClick = useRef(false);
  return (
    <button
      type="button"
      className={`toggle-switch ${checked ? 'on' : ''}`}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onPointerDown={(event) => {
        start.current = event.clientX;
        skipClick.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (start.current !== null && Math.abs(event.clientX - start.current) > 10) {
          skipClick.current = true;
          onChange(event.clientX > start.current);
        }
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onClick={() => {
        if (skipClick.current) {
          skipClick.current = false;
          return;
        }
        onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}
