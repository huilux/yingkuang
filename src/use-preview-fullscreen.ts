import { useEffect, useRef, useState, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createFullscreenSession } from "./preview-fullscreen";

export function usePreviewFullscreen(element: RefObject<HTMLElement | null>, onClose: () => void, onChange: (value: boolean) => void, startFullscreen = false) {
  const [fullscreen, setFullscreen] = useState(false);
  const [starting, setStarting] = useState(startFullscreen);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const session = useRef<ReturnType<typeof createFullscreenSession> | null>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  const closing = useRef(false);
  const wasFullscreen = useRef(false);
  const callbacks = useRef({ onClose, onChange });
  callbacks.current = { onClose, onChange };
  const update = (value: boolean) => {
    if (!alive.current) return;
    const exited = wasFullscreen.current && !value;
    wasFullscreen.current = value;
    // Browser Escape and the window manager can exit without a React key event.
    // Keep the image-only view until close completes, avoiding a toolbar flash.
    if (exited) { if (!closing.current) void close(); return; }
    setFullscreen(value); callbacks.current.onChange(value);
  };
  useEffect(() => {
    alive.current = true;
    let active = true;
    const native = "__TAURI_INTERNALS__" in window;
    const current = createFullscreenSession(native ? {
      isFullscreen: async () => !!(await getCurrentWindow().isFullscreen()),
      setFullscreen: async value => { await getCurrentWindow().setFullscreen(value); },
    } : {
      isFullscreen: async () => !!document.fullscreenElement,
      setFullscreen: async value => {
        if (value) {
          if (!element.current?.requestFullscreen) throw new Error("当前浏览器不支持全屏");
          await element.current.requestFullscreen();
        } else if (document.fullscreenElement) await document.exitFullscreen();
      },
    });
    session.current = current;
    const refresh = () => { void current.read().then(value => { if (active) update(value); }).catch(() => {}); };
    let unlisten: (() => void) | undefined;
    if (native) {
      try { void getCurrentWindow().onResized(refresh).then(stop => { if (active) unlisten = stop; else stop(); }).catch(() => {}); }
      catch { /* A missing window API must not prevent ordinary preview. */ }
    } else document.addEventListener("fullscreenchange", refresh);
    // Run while the opening key/click still has browser user activation. Do not
    // wait for lazy canvas/image loading before requesting fullscreen.
    void current.read().then(async value => {
      if (!active) return;
      update(value);
      if (startFullscreen) await change(true);
      if (active) setStarting(false);
    }).catch(() => { if (active) { if (startFullscreen) void change(true); setStarting(false); } });
    return () => {
      active = false; alive.current = false;
      unlisten?.(); document.removeEventListener("fullscreenchange", refresh);
      if (session.current === current) session.current = null;
      callbacks.current.onChange(false);
      void current.dispose().catch(() => {});
    };
  }, [element]);

  async function change(value?: boolean) {
    const current = session.current;
    if (!current || busy.current || closing.current) return;
    busy.current = true; setPending(true); setError("");
    try {
      const next = value ?? !(await current.read());
      if (closing.current || !alive.current) return;
      update(await current.set(next));
      if (next && alive.current) element.current?.querySelector<HTMLElement>(".result-preview-canvas")?.focus({ preventScroll: true });
    } catch (cause) { if (alive.current) setError(`全屏切换失败：${String(cause)}`); }
    finally { busy.current = false; if (alive.current) setPending(closing.current); }
  }
  async function close() {
    if (closing.current) return;
    const current = session.current;
    if (!current) { callbacks.current.onClose(); return; }
    closing.current = true; setPending(true); setError("");
    try { await current.restore(); if (alive.current) callbacks.current.onClose(); }
    catch (cause) { if (alive.current) setError(`恢复窗口失败，请重试：${String(cause)}`); }
    finally { closing.current = false; if (alive.current) setPending(busy.current); }
  }
  return { fullscreen, starting, pending, error, enter: () => change(true), close };
}
