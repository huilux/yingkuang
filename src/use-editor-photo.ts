import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PhotoAsset } from "./types";

// Keep compressed browser originals, never all decoded full-size bitmaps.
const browserFiles = new Map<string, Blob>();
export function retainBrowserPhoto(id: string, file: Blob) { browserFiles.set(id, file); }
export function releaseBrowserPhotos() { browserFiles.clear(); }

export function useEditorPhoto(photo: PhotoAsset) {
  const [image, setImage] = useState<HTMLImageElement | HTMLCanvasElement | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setError(false);
    setLoading(true);
    async function load() {
      // Avoid duplicate IPC work from StrictMode's discarded first effect.
      await Promise.resolve();
      if (cancelled) return;
      const fallback = new Image();
      fallback.src = photo.thumbnailDataUrl;
      await fallback.decode();
      if (cancelled) return;
      setImage(fallback);
      const file = browserFiles.get(photo.id);
      if (file) {
        const bitmap = await createImageBitmap(file);
        try {
          if (cancelled) return;
          const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("无法生成高清编辑图");
          context.imageSmoothingQuality = "high";
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          setImage(canvas);
        } finally { bitmap.close(); }
        return;
      }
      if (!photo.path || !("__TAURI_INTERNALS__" in window)) return;
      const source = await invoke<string>("load_editor_photo", { path: photo.path });
      if (cancelled) return;
      const next = new Image();
      next.src = source;
      await next.decode();
      if (!cancelled) setImage(next);
    }
    void load().catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [photo.id, photo.path, photo.thumbnailDataUrl]);
  return { image, error, loading };
}
