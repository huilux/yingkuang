import { useEffect, useRef, useState } from "react";

export function NumericInput({ label, value, min, max, step = 1, onCommit, onPreview, disabled = false, isValid, normalize }: {
  label: string; value: number; min?: number; max?: number; step?: number; disabled?: boolean; isValid?: (value: number) => boolean; onCommit: (value: number) => void;
  /** Optional live draft preview; Escape or invalid input restores the value at focus. */
  onPreview?: (value: number) => void;
  normalize?: (value: number) => number;
}) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const cancelled = useRef(false);
  const initialValue = useRef(value);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  function commit() {
    editing.current = false;
    const parsed = Number(draft);
    if (cancelled.current || !draft.trim() || !Number.isFinite(parsed)) {
      const restored = onPreview ? initialValue.current : value;
      setDraft(String(restored)); onPreview?.(restored); cancelled.current = false; return;
    }
    const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    const next = normalize ? normalize(bounded) : bounded;
    if (isValid && !isValid(next)) { const restored = onPreview ? initialValue.current : value; setDraft(String(restored)); onPreview?.(restored); return; }
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }
  return <input className="text-input" type="number" aria-label={label} min={min} max={max} step={step} value={draft} disabled={disabled}
    onFocus={() => { editing.current = true; cancelled.current = false; initialValue.current = value; }} onChange={event => {
      const text = event.currentTarget.value;
      setDraft(text);
      const next = Number(text);
      if (onPreview && text.trim() && Number.isFinite(next) && next >= (min ?? -Infinity) && next <= (max ?? Infinity) && (!isValid || isValid(next))) onPreview(next);
    }} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") { event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); } }} />;
}
