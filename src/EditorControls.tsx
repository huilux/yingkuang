export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
  onStart,
  onEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  return (
    <label className="field slider-field">
      <span className="field-heading"><span>{label}</span><output>{value}{suffix}</output></span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
        onBlur={onEnd}
        onKeyDown={event => { if (event.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(event.key)) onStart?.(); }}
        onKeyUp={onEnd}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="field segmented-field">
      <legend>{label}</legend>
      <div className="segmented">
        {options.map((option) => (
          <button className={value === option.value ? "selected" : ""} key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
