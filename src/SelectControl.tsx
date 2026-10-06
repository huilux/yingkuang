import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type SelectHTMLAttributes } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { createPortal } from "react-dom";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size" | "defaultValue" | "value"> & { value: string | number };
type Option = { value: string; label: string; disabled: boolean };

/** A single-value combobox. The native backing control keeps form/change semantics. */
export function SelectControl({ children, className = "", disabled, id, ...props }: Props) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listId = `${triggerId}-options`;
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const native = useRef<HTMLSelectElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const options: Option[] = Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: string; disabled?: boolean }>(child) || child.type !== "option") return [];
    return [{ value: String(child.props.value ?? child.props.children ?? ""), label: String(child.props.children ?? ""), disabled: !!child.props.disabled }];
  });
  const selected = Math.max(0, options.findIndex(option => option.value === String(props.value)));
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);

  function show(index = selected) {
    if (!trigger.current || trigger.current.matches(":disabled")) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const height = Math.min(280, options.length * 36 + 10);
    const upward = below < height && above > below;
    const maxHeight = Math.max(36, Math.min(height, upward ? above : below));
    const width = Math.min(Math.max(rect.width, 180), innerWidth - 24);
    setPosition({ left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), top: upward ? rect.top - maxHeight - 4 : rect.bottom + 4, width, maxHeight });
    setActive(options[index]?.disabled ? enabled[0] ?? 0 : index);
    setOpen(true);
    search.current = { text: "", time: 0 };
  }

  function choose(index: number) {
    if (options[index]?.disabled || !native.current || native.current.matches(":disabled")) return;
    native.current.value = options[index].value;
    native.current.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    const list = menu.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !list || !option) return;
    // Scroll only the popup. WebKit may scroll its containing dialog with scrollIntoView.
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [active, open]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "Escape") {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    let next: number | undefined;
    if (event.key === "ArrowDown") next = open ? enabled[Math.min(enabled.length - 1, enabled.indexOf(active) + 1)] : selected;
    if (event.key === "ArrowUp") next = open ? enabled[Math.max(0, enabled.indexOf(active) - 1)] : selected;
    if (event.key === "Home") next = enabled[0];
    if (event.key === "End") next = enabled[enabled.length - 1];
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation();
      if (open) choose(active); else show();
      return;
    }
    if (event.key.length === 1 && !event.altKey) {
      const now = performance.now();
      const text = (now - search.current.time < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
      search.current = { text, time: now };
      const found = enabled.find(index => options[index].label.toLocaleLowerCase().startsWith(text));
      if (found !== undefined) next = found;
    }
    if (next !== undefined) {
      event.preventDefault(); event.stopPropagation();
      if (open) setActive(next); else show(next);
    }
  }

  return <span className={`select-control ${className}`} ref={wrapper}>
    <button id={triggerId} ref={trigger} className="select-trigger" type="button" role="combobox" disabled={disabled}
      aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined}
      title={props.title ?? options[selected]?.label} onClick={() => open ? setOpen(false) : show()} onKeyDown={onKeyDown}>
      <span>{options[selected]?.label}</span><CaretDown aria-hidden="true" />
    </button>
    <select {...props} ref={native} disabled={disabled} hidden aria-hidden="true" tabIndex={-1}>{children}</select>
    {open && wrapper.current && createPortal(<span id={listId} className="select-menu" ref={menu} role="listbox" aria-label={props["aria-label"]}
      style={position} onMouseDown={event => event.preventDefault()} onClick={event => event.preventDefault()}>
      {options.map((option, index) => <span id={`${listId}-${index}`} key={option.value} role="option" aria-label={option.label} aria-selected={selected === index}
        aria-disabled={option.disabled || undefined} data-index={index} className={`select-option ${active === index ? "active" : ""}`}
        onPointerMove={() => { if (!option.disabled) setActive(index); }}
        onPointerUp={event => { if (event.button === 0) choose(index); }} onClick={() => choose(index)}>
        <span>{option.label}</span>{selected === index && <Check aria-hidden="true" weight="bold" />}
      </span>)}
    </span>, wrapper.current.closest("label")?.parentElement ?? wrapper.current, listId)}
  </span>;
}
