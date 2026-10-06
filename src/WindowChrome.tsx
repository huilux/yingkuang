import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CopySimple, Minus, Square, X } from "@phosphor-icons/react";

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0];
const directions: ResizeDirection[] = ["North", "NorthEast", "East", "SouthEast", "South", "SouthWest", "West", "NorthWest"];

export function WindowChrome({ enabled }: { enabled: boolean }) {
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  const chrome = useRef<HTMLDivElement>(null);

  async function run(action: () => Promise<unknown>) {
    try { setError(""); await action(); }
    catch (cause) { setError(`窗口操作失败：${String(cause)}`); }
  }

  async function toggleMaximize() {
    const current = getCurrentWindow();
    await current.toggleMaximize();
    setMaximized(await current.isMaximized());
  }

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    async function trackSize() {
      try {
        const current = getCurrentWindow();
        const refresh = async () => {
          const value = await current.isMaximized();
          if (!disposed) setMaximized(!!value);
        };
        await refresh();
        const stop = await current.onResized(() => { void refresh().catch(() => {}); });
        if (disposed) stop(); else unlisten = stop;
      } catch { /* Browser IPC fixtures may not provide window metadata. */ }
    }
    void trackSize();
    const drag = (event: MouseEvent) => {
      const target = event.target;
      if (event.button !== 0 || !(target instanceof Element) || !target.closest("[data-window-drag]")
        || target.closest('button, input, select, [role="combobox"], [inert]')) return;
      event.preventDefault();
      void run(() => event.detail === 2 ? toggleMaximize() : getCurrentWindow().startDragging());
    };
    const header = chrome.current?.parentElement?.querySelector(".app-header");
    header?.addEventListener("mousedown", drag as EventListener);
    return () => { disposed = true; unlisten?.(); header?.removeEventListener("mousedown", drag as EventListener); };
  }, [enabled]);

  if (!enabled) return null;
  return <div className="window-chrome" data-window-chrome ref={chrome}>
    <div className="window-controls" onMouseDown={event => event.preventDefault()}>
      <button type="button" tabIndex={-1} aria-label="最小化窗口" title="最小化" onClick={() => void run(() => getCurrentWindow().minimize())}><Minus /></button>
      <button type="button" tabIndex={-1} aria-label={maximized ? "还原窗口" : "最大化窗口"} title={maximized ? "还原" : "最大化"} onClick={() => void run(toggleMaximize)}>{maximized ? <CopySimple /> : <Square />}</button>
      <button className="window-close" type="button" tabIndex={-1} aria-label="关闭窗口" title="关闭" onClick={() => void run(() => getCurrentWindow().close())}><X /></button>
    </div>
    {!maximized && directions.map(direction => <div key={direction} className={`window-resize window-resize-${direction}`} aria-hidden="true"
      onMouseDown={event => { if (event.button === 0) { event.preventDefault(); void run(() => getCurrentWindow().startResizeDragging(direction)); } }} />)}
    {error && <div className="window-control-error" role="alert">{error}<button type="button" aria-label="关闭窗口操作提示" onClick={() => setError("")}><X /></button></div>}
  </div>;
}
