import { useEffect, useRef, useState } from "react";

export function NumericInput({ label, value, min, max, step = 1, onCommit, disabled = false, isValid }: {
  label: string; value: number; min?: number; max?: number; step?: number; disabled?: boolean; isValid?: (value: number) => boolean; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  function commit() {
    editing.current = false;
    const parsed = Number(draft);
    if (cancelled.current || !draft.trim() || !Number.isFinite(parsed)) { setDraft(String(value)); cancelled.current = false; return; }
    const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    if (isValid && !isValid(next)) { setDraft(String(value)); return; }
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }
  return <input className="text-input" type="number" aria-label={label} min={min} max={max} step={step} value={draft} disabled={disabled}
    onFocus={() => { editing.current = true; cancelled.current = false; }} onChange={event => setDraft(event.currentTarget.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") { event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); } }} />;
}
