import { useEffect, useRef, useState, type ReactNode } from "react";

const svgNamespace = "http://www.w3.org/2000/svg";

async function dataUrl(source: string, signal: AbortSignal) {
  if (source.startsWith("data:")) return source;
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error("无法读取预览图片");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function rasterize(source: SVGGElement, width: number, height: number, signal: AbortSignal) {
  const svg = document.createElementNS(svgNamespace, "svg");
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const pixelWidth = Math.max(1, Math.round(width * scale));
  const pixelHeight = Math.max(1, Math.round(height * scale));
  svg.setAttribute("width", String(pixelWidth));
  svg.setAttribute("height", String(pixelHeight));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const definitions = source.ownerSVGElement?.querySelector("defs");
  if (definitions) svg.append(definitions.cloneNode(true));
  svg.append(source.cloneNode(true));
  // SVG images loaded as an image cannot fetch nested external resources.
  const sources = new Map<string, Promise<string>>();
  for (const image of svg.querySelectorAll("image")) {
    const href = image.getAttribute("href") ?? "";
    if (!sources.has(href)) sources.set(href, dataUrl(href, signal));
    image.setAttribute("href", await sources.get(href)!);
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = svgUrl;
    await image.decode();
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成相框预览");
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error("无法缓存相框预览")), "image/png");
    });
    return URL.createObjectURL(blob);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

// Cache the photo, blur and shadow independently of zoom and watermark edits.
// Rasterizing the existing SVG also works where Canvas2D.filter is unsupported.
export function PreviewBackdrop({ cacheKey, width, height, children }: {
  cacheKey: string;
  width: number;
  height: number;
  children: ReactNode;
}) {
  const sourceRef = useRef<SVGGElement>(null);
  const liveUrlRef = useRef<string | null>(null);
  const [cached, setCached] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    const controller = new AbortController();
    let url: string | undefined;
    void rasterize(source, width, height, controller.signal).then(result => {
      if (controller.signal.aborted) {
        URL.revokeObjectURL(result);
        return;
      }
      url = result;
      liveUrlRef.current = result;
      setCached({ key: cacheKey, url: result });
    }).catch(() => {
      // Keep the live SVG as a correct fallback if rasterization is unavailable.
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
      if (liveUrlRef.current === url) liveUrlRef.current = null;
    };
  }, [cacheKey, width, height]);

  return cached?.key === cacheKey && cached.url === liveUrlRef.current
    ? <image className="preview-backdrop" href={cached.url} width={width} height={height} preserveAspectRatio="none" />
    : <g ref={sourceRef} className="preview-backdrop-source">{children}</g>;
}
