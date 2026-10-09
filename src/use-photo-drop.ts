import { useEffect, useRef, useState } from "react";
import { listen, TauriEvent } from "@tauri-apps/api/event";

type PhotoDropOptions = {
  native: boolean;
  blockedReason: string;
  onPaths: (paths: string[]) => void;
  onFiles: (files: File[]) => void;
  onMessage: (message: string) => void;
};

export function usePhotoDrop(options: PhotoDropOptions): boolean {
  const latest = useRef(options);
  latest.current = options;
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const disposers: Array<() => void> = [];
    const reset = () => setDragging(false);
    const accept = () => {
      reset();
      if (latest.current.blockedReason) {
        latest.current.onMessage(latest.current.blockedReason);
        return false;
      }
      return true;
    };
    if (options.native) {
      // This app has one window. Native file paths arrive through Tauri events,
      // rather than the HTML File API, so EXIF and session restoration still work.
      const register = async (name: string, handler: (paths: string[]) => void) => {
        const unlisten = await listen<{ paths?: string[] }>(name, event => {
          if (!cancelled) handler(event.payload?.paths ?? []);
        });
        if (cancelled) unlisten(); else disposers.push(unlisten);
      };
      void Promise.all([
        register(TauriEvent.DRAG_ENTER, () => setDragging(true)),
        register(TauriEvent.DRAG_LEAVE, reset),
        register(TauriEvent.DRAG_DROP, paths => { if (accept()) latest.current.onPaths(paths); }),
      ]).catch(error => {
        if (!cancelled) latest.current.onMessage(`拖入监听失败，请使用添加照片：${String(error)}`);
      });
    } else {
      let depth = 0;
      const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
      const enter = (event: DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        depth++;
        setDragging(true);
      };
      const over = (event: DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = latest.current.blockedReason ? "none" : "copy";
      };
      const leave = () => {
        depth = Math.max(0, depth - 1);
        if (!depth) reset();
      };
      const drop = (event: DragEvent) => {
        if (!isFileDrag(event)) return;
        // Prevent the webview from navigating to the dropped image.
        event.preventDefault();
        depth = 0;
        if (accept()) latest.current.onFiles(Array.from(event.dataTransfer?.files ?? []));
      };
      const blur = () => { depth = 0; reset(); };
      window.addEventListener("dragenter", enter);
      window.addEventListener("dragover", over);
      window.addEventListener("dragleave", leave);
      window.addEventListener("drop", drop);
      window.addEventListener("blur", blur);
      disposers.push(() => {
        window.removeEventListener("dragenter", enter);
        window.removeEventListener("dragover", over);
        window.removeEventListener("dragleave", leave);
        window.removeEventListener("drop", drop);
        window.removeEventListener("blur", blur);
      });
    }
    return () => { cancelled = true; disposers.forEach(dispose => dispose()); };
  }, [options.native]);

  return dragging;
}
