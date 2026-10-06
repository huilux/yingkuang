import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { metadataOptionsForPhoto } from "./editor-model";
import type { LayerSource, PhotoAsset } from "./types";

export function ParameterPicker({ photo, onAdd }: { photo?: PhotoAsset; onAdd: (source: LayerSource) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = metadataOptionsForPhoto(photo).filter(option => !query.trim()
    || `${option.label} ${option.sourceLabel} ${option.value ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => { setOpen(false); }, [photo?.id]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const buttons = Array.from(optionsRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const inSearch = event.target === search.current;
    if ((!inSearch && index < 0) || !buttons.length) return;
    let target: HTMLElement | undefined;
    if (event.key === "ArrowDown") target = inSearch ? buttons[0] : buttons[index + 1] ?? search.current!;
    if (event.key === "ArrowUp") target = inSearch ? buttons[buttons.length - 1] : buttons[index - 1] ?? search.current!;
    if (!inSearch && event.key === "Home") target = buttons[0];
    if (!inSearch && event.key === "End") target = buttons[buttons.length - 1];
    if (target) {
      event.preventDefault();
      event.stopPropagation();
      target.focus();
    }
  }

  return <div className="layer-add-wrap" ref={wrapper}>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setOpen(value => !value); setQuery(""); }}><Plus /> 添加参数</button>
    {open && <div id={id} className="layer-add-menu" role="dialog" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
      <div className="parameter-picker-heading"><strong id={`${id}-title`}>添加水印参数</strong><button className="icon-button" type="button" aria-label="关闭参数选择" onClick={close}><X /></button></div>
      <input ref={search} autoFocus type="search" aria-label="搜索元数据参数" placeholder="搜索名称、值或 EXIF 标签" value={query} onChange={event => setQuery(event.currentTarget.value)} />
      <div className="layer-add-options" ref={optionsRef}>{options.map(option => <button type="button" key={option.source} data-parameter-source={option.source} onClick={() => { onAdd(option.source); close(); }}>
        <span className="parameter-option-heading"><strong>{option.label}</strong><em>{option.source === "custom" ? "手动输入" : option.value ? "已读取" : "未读取"}</em></span>
        <small title={option.sourceLabel}>{option.sourceLabel}</small>
        <span className="parameter-option-value" title={option.value}>{option.value || (option.source === "custom" ? "添加自己的文字" : "添加后可手动补充")}</span>
      </button>)}</div>
      {!options.length && <div className="parameter-picker-empty"><p>没有匹配的参数</p><button type="button" onClick={() => { setQuery(""); search.current?.focus(); }}>清除搜索</button></div>}
      <p className="parameter-picker-hint">{options.length} 项 · ↑↓ 选择 · Esc 关闭</p>
    </div>}
  </div>;
}
