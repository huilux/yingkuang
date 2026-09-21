import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import {
  calculateGeometry,
  globalToRegion,
  layerPosition,
  resolveLayerText,
} from "./editor-model";
import type { EditorDocument, PhotoAsset, Rect, RegionId, WatermarkLayer } from "./types";
import { PreviewBackdrop } from "./PreviewBackdrop";

type Guide = {
  axis: "x" | "y";
  value: number;
  label: string;
  tone: "canvas" | "region" | "photo";
};

type DragState = {
  layerId: string;
  pointerId: number;
  startClient: { x: number; y: number };
  startPoint: { x: number; y: number };
  origin: { x: number; y: number };
  moved: boolean;
};

type ZoomAnchor = { x: number; y: number; viewportX: number; viewportY: number };

const regionNames: Record<RegionId, string> = {
  canvas: "整个画布",
  top: "上参数区",
  bottom: "下参数区",
  left: "左参数区",
  right: "右参数区",
};

function insideRegion(layer: WatermarkLayer, document: EditorDocument) {
  return layer.region === "canvas" || document.regions[layer.region].enabled;
}

function safeRect(rect: Rect, safe: number) {
  const inset = Math.min(rect.width, rect.height) * safe / 100;
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(1, rect.width - inset * 2),
    height: Math.max(1, rect.height - inset * 2),
  };
}

export function EditorCanvas({
  photo,
  document,
  zoom,
  selectedLayerId,
  snapEnabled,
  onZoomChange,
  onSelectLayer,
  onLayerPreview,
  onDragStart,
  onDragEnd,
  viewportRef,
}: {
  photo: PhotoAsset;
  document: EditorDocument;
  zoom: number;
  selectedLayerId: string;
  snapEnabled: boolean;
  onZoomChange: (zoom: number) => void;
  onSelectLayer: (id: string) => void;
  onLayerPreview: (id: string, patch: Partial<WatermarkLayer>) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const queuedZoomRef = useRef(zoom);
  const wheelAnchorRef = useRef<ZoomAnchor | null>(null);
  const lastWheelAnchorRef = useRef<ZoomAnchor | null>(null);
  const appliedScrollRef = useRef({ left: 0, top: 0 });
  const centerAnchorRef = useRef<ZoomAnchor | null>(null);
  const previousZoomRef = useRef(zoom);
  const [guides, setGuides] = useState<Guide[]>([]);
  const geometry = useMemo(() => calculateGeometry(photo, document), [document, photo]);
  const previewBaseWidth = Math.max(420, Math.min(860, geometry.width * 0.48));
  const previewBaseHeight = previewBaseWidth * geometry.height / geometry.width;
  const zoomScale = zoom / 100;
  const blurOverscan = Math.min(
    Math.min(geometry.width, geometry.height) * 0.25,
    Math.max(Math.min(geometry.width, geometry.height) * 0.08, document.frame.blur * 3),
  );
  const selectedLayer = document.layers.find((item) => item.id === selectedLayerId);
  const selectedRegion = selectedLayer?.region ?? "canvas";
  const selectedBounds = geometry.regions[selectedRegion];
  const backdropKey = photo.thumbnailDataUrl + JSON.stringify([document.frame, geometry.width, geometry.height, geometry.photo]);

  function captureAnchor(clientX?: number, clientY?: number): ZoomAnchor | null {
    const viewport = viewportRef.current;
    const svg = svgRef.current;
    if (!viewport || !svg) return null;
    const bounds = viewport.getBoundingClientRect();
    const canvas = svg.getBoundingClientRect();
    const viewportX = clientX === undefined ? viewport.clientWidth / 2 : clientX - bounds.left;
    const viewportY = clientY === undefined ? viewport.clientHeight / 2 : clientY - bounds.top;
    return {
      x: (bounds.left + viewportX - canvas.left) / canvas.width,
      y: (bounds.top + viewportY - canvas.top) / canvas.height,
      viewportX,
      viewportY,
    };
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const svg = svgRef.current;
    const wheelAnchor = wheelAnchorRef.current;
    const anchor = wheelAnchor ?? centerAnchorRef.current;
    if (!wheelAnchor) lastWheelAnchorRef.current = null;
    if (viewport && svg && anchor && previousZoomRef.current !== zoom) {
      if (!wheelAnchor) {
        anchor.viewportX = viewport.clientWidth / 2;
        anchor.viewportY = viewport.clientHeight / 2;
      }
      const bounds = viewport.getBoundingClientRect();
      const canvas = svg.getBoundingClientRect();
      // Correct before paint; CSS scroll anchoring must not also move the canvas.
      viewport.scrollLeft += canvas.left + anchor.x * canvas.width - bounds.left - anchor.viewportX;
      viewport.scrollTop += canvas.top + anchor.y * canvas.height - bounds.top - anchor.viewportY;
      if (wheelAnchor) {
        const actual = captureAnchor(bounds.left + anchor.viewportX, bounds.top + anchor.viewportY);
        if (actual) {
          // A centred, fitting canvas has no scroll range. Rebase only the
          // clamped axis so crossing into overflow never jumps back to an
          // unreachable anchor from an earlier, smaller scale.
          if (Math.abs(actual.x - anchor.x) * canvas.width > 1.1) anchor.x = actual.x;
          if (Math.abs(actual.y - anchor.y) * canvas.height > 1.1) anchor.y = actual.y;
        }
      }
    }
    previousZoomRef.current = zoom;
    if (!wheelAnchor) queuedZoomRef.current = zoom;
    wheelAnchorRef.current = null;
    const center = captureAnchor();
    if (wheelAnchor || !anchor) centerAnchorRef.current = center;
    else if (center && svg) {
      const bounds = svg.getBoundingClientRect();
      // Keep the exact anchor across slider/button updates. Only rebase an
      // axis when the scroll boundary prevents preserving its position.
      if (Math.abs(center.x - anchor.x) * bounds.width > 1.1) anchor.x = center.x;
      if (Math.abs(center.y - anchor.y) * bounds.height > 1.1) anchor.y = center.y;
    }
    if (viewport) appliedScrollRef.current = { left: viewport.scrollLeft, top: viewport.scrollTop };
  }, [zoom, previewBaseWidth, previewBaseHeight]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function handleWheel(event: globalThis.WheelEvent) {
      if (!event.ctrlKey) {
        lastWheelAnchorRef.current = null;
        return;
      }
      event.preventDefault();
      if (event.deltaY === 0 || dragRef.current) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport!.clientHeight : 1;
      // Match the prototype's proportional response; do not discard small
      // trackpad deltas by rounding each event before the frame is committed.
      const next = Math.max(20, Math.min(300, queuedZoomRef.current * Math.exp(-event.deltaY * unit * 0.0015)));
      if (next === queuedZoomRef.current) return;
      const anchor = captureAnchor(event.clientX, event.clientY);
      const lastAnchor = lastWheelAnchorRef.current;
      // Scroll offsets can round to whole pixels. Reuse the same photo point
      // across a stationary gesture so that rounding does not accumulate.
      wheelAnchorRef.current = anchor && lastAnchor
        && anchor.viewportX === lastAnchor.viewportX && anchor.viewportY === lastAnchor.viewportY
        ? lastAnchor : anchor;
      lastWheelAnchorRef.current = wheelAnchorRef.current;
      queuedZoomRef.current = next;
      if (zoomFrameRef.current !== null) return;
      zoomFrameRef.current = requestAnimationFrame(() => {
        zoomFrameRef.current = null;
        if (queuedZoomRef.current === previousZoomRef.current) {
          wheelAnchorRef.current = null;
          return;
        }
        // Apply scale and anchor correction in the same animation frame.
        // A deferred commit can otherwise consume the next wheel event's
        // anchor and paint one frame at the wrong scroll position.
        flushSync(() => onZoomChange(queuedZoomRef.current));
      });
    }
    // React delegates wheel events through a passive listener in Chromium.
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = null;
    };
  }, [onZoomChange, viewportRef]);

  function clientPoint(event: { clientX: number; clientY: number }) {
    const svg = svgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM()?.inverse();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }

  function candidateGuides(layer: WatermarkLayer): Guide[] {
    const source = layer.region === "canvas"
      ? geometry.regions.canvas
      : safeRect(geometry.regions[layer.region], document.regions[layer.region].safePadding);
    const name = regionNames[layer.region];
    const items: Guide[] = [
      { axis: "x", value: source.x + source.width / 2, label: `${name} · 水平居中`, tone: layer.region === "canvas" ? "canvas" : "region" },
      { axis: "y", value: source.y + source.height / 2, label: `${name} · 垂直居中`, tone: layer.region === "canvas" ? "canvas" : "region" },
      { axis: "x", value: source.x + source.width / 3, label: `${name} · 宽度 1/3`, tone: "region" },
      { axis: "x", value: source.x + source.width * 2 / 3, label: `${name} · 宽度 2/3`, tone: "region" },
      { axis: "y", value: source.y + source.height / 3, label: `${name} · 高度 1/3`, tone: "region" },
      { axis: "y", value: source.y + source.height * 2 / 3, label: `${name} · 高度 2/3`, tone: "region" },
    ];
    if (layer.region !== "canvas") {
      items.push(
        { axis: "x", value: geometry.width / 2, label: "画布 · 水平居中", tone: "canvas" },
        { axis: "y", value: geometry.height / 2, label: "画布 · 垂直居中", tone: "canvas" },
        { axis: "x", value: geometry.photo.x + geometry.photo.width / 2, label: "照片 · 水平居中", tone: "photo" },
        { axis: "y", value: geometry.photo.y + geometry.photo.height / 2, label: "照片 · 垂直居中", tone: "photo" },
      );
    }
    return items;
  }

  function snapPoint(layer: WatermarkLayer, point: { x: number; y: number }) {
    if (!snapEnabled) return { point, guides: [] as Guide[] };
    const svg = svgRef.current;
    const width = svg?.getBoundingClientRect().width ?? 1;
    const threshold = geometry.width * 9 / Math.max(1, width);
    const found: Guide[] = [];
    let x = point.x;
    let y = point.y;
    for (const axis of ["x", "y"] as const) {
      const nearest = candidateGuides(layer)
        .filter((guide) => guide.axis === axis)
        .map((guide) => ({ guide, distance: Math.abs(point[axis] - guide.value) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest && nearest.distance <= threshold) {
        if (axis === "x") x = nearest.guide.value;
        else y = nearest.guide.value;
        found.push(nearest.guide);
      }
    }
    return { point: { x, y }, guides: found };
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const layer = document.layers.find((item) => item.id === drag.layerId);
    const point = clientPoint(event);
    if (!layer || !point) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y) < 4) return;
      drag.moved = true;
      onDragStart();
    }
    const snapped = snapPoint(layer, {
      x: drag.origin.x + point.x - drag.startPoint.x,
      y: drag.origin.y + point.y - drag.startPoint.y,
    });
    const local = globalToRegion(snapped.point.x, snapped.point.y, layer.region, geometry);
    setGuides(snapped.guides);
    onLayerPreview(layer.id, local);
  }

  function finishDrag(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      svgRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released if the window lost focus.
    }
    setGuides([]);
    if (drag.moved) onDragEnd();
  }

  function nudgeLayer(event: KeyboardEvent<SVGGElement>, layer: WatermarkLayer) {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const bounds = geometry.regions[layer.region];
    onDragStart();
    onLayerPreview(layer.id, {
      x: Math.max(0, Math.min(1, layer.x + direction[0] * step / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(1, layer.y + direction[1] * step / Math.max(1, bounds.height))),
    });
    onDragEnd();
  }

  const selectedRegionVisible = selectedLayer && selectedLayer.region !== "canvas";

  return (
    <div className="canvas-viewport" onScroll={(event) => {
      const viewport = event.currentTarget;
      const applied = appliedScrollRef.current;
      if (viewport.scrollLeft !== applied.left || viewport.scrollTop !== applied.top) {
        lastWheelAnchorRef.current = null;
        centerAnchorRef.current = captureAnchor();
      }
      appliedScrollRef.current = { left: viewport.scrollLeft, top: viewport.scrollTop };
    }} ref={viewportRef}>
      <div className="canvas-stage">
        <div
          className="preview-scale svg-preview"
          style={{
            "--preview-base-width": `${previewBaseWidth}px`,
            "--preview-zoom": zoomScale,
            width: `${previewBaseWidth * zoomScale}px`,
            height: `${previewBaseHeight * zoomScale}px`,
          } as CSSProperties}
        >
        <svg
          ref={svgRef}
          className="design-canvas"
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          role="img"
          aria-label={`${photo.fileName} 的相框设计画布`}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onSelectLayer("");
          }}
        >
          <defs>
            <filter id="background-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation={document.frame.blur} />
              <feComponentTransfer>
                <feFuncR type="linear" slope={document.frame.brightness / 100} />
                <feFuncG type="linear" slope={document.frame.brightness / 100} />
                <feFuncB type="linear" slope={document.frame.brightness / 100} />
              </feComponentTransfer>
            </filter>
            <filter id="photo-shadow" x="-30%" y="-30%" width="160%" height="170%">
              <feDropShadow
                dx="0"
                dy={document.frame.shadow * 0.28}
                stdDeviation={document.frame.shadow * 0.42}
                floodColor="#070909"
                floodOpacity={Math.min(0.4, document.frame.shadow / 100)}
              />
            </filter>
            <clipPath id="photo-clip">
              <rect {...geometry.photo} rx={document.frame.radius * 2} />
            </clipPath>
            <clipPath id="canvas-clip">
              <rect width={geometry.width} height={geometry.height} />
            </clipPath>
          </defs>

          <PreviewBackdrop cacheKey={backdropKey} width={geometry.width} height={geometry.height}>
          <rect width={geometry.width} height={geometry.height} fill={document.frame.color} />
          {document.frame.type === "blur" && (
            <g clipPath="url(#canvas-clip)">
              <image
                href={photo.thumbnailDataUrl}
                x={-blurOverscan}
                y={-blurOverscan}
                width={geometry.width + blurOverscan * 2}
                height={geometry.height + blurOverscan * 2}
                preserveAspectRatio="xMidYMid slice"
                filter="url(#background-blur)"
              />
              <rect width={geometry.width} height={geometry.height} fill="#101312" opacity="0.08" />
            </g>
          )}
          <g filter={document.frame.shadow ? "url(#photo-shadow)" : undefined}>
            <image
              href={photo.thumbnailDataUrl}
              {...geometry.photo}
              preserveAspectRatio="none"
              clipPath="url(#photo-clip)"
            />
          </g>
          </PreviewBackdrop>

          {selectedRegionVisible && (
            <g className="selected-region-guide" aria-hidden="true">
              <rect {...selectedBounds} />
              <text x={selectedBounds.x + 12} y={selectedBounds.y + 24}>{regionNames[selectedRegion]}</text>
            </g>
          )}

          {document.layers.filter((item) => item.visible && insideRegion(item, document)).map((item) => {
            const position = layerPosition(item, geometry);
            const text = resolveLayerText(item, photo);
            const selected = item.id === selectedLayerId;
            const width = Math.max(item.fontSize * 2.2, text.length * item.fontSize * 0.62 + 22);
            return (
              <g
                key={item.id}
                className={`watermark-layer ${selected ? "selected" : ""} ${text.startsWith("未读取到") ? "missing" : ""}`}
                transform={`translate(${position.x} ${position.y}) rotate(${item.rotation})`}
                role="button"
                aria-label={`${item.name}：${text}`}
                tabIndex={0}
                onKeyDown={(event) => nudgeLayer(event, item)}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
                  const point = clientPoint(event);
                  if (!point) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.focus({ preventScroll: true });
                  onSelectLayer(item.id);
                  dragRef.current = {
                    layerId: item.id,
                    pointerId: event.pointerId,
                    startClient: { x: event.clientX, y: event.clientY },
                    startPoint: point,
                    origin: position,
                    moved: false,
                  };
                  svgRef.current?.setPointerCapture(event.pointerId);
                }}
              >
                {selected && <rect className="selection-box" x={-width / 2} y={-item.fontSize * 0.82} width={width} height={item.fontSize * 1.64} rx="6" />}
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={item.color}
                  fillOpacity={item.opacity}
                  fontFamily={item.fontFamily}
                  fontSize={item.fontSize}
                  fontWeight={item.fontWeight}
                >
                  {text}
                </text>
              </g>
            );
          })}

          {guides.map((guide) => (
            <g className={`snap-guide ${guide.tone}`} key={`${guide.axis}-${guide.value}-${guide.label}`} aria-hidden="true">
              {guide.axis === "x" ? (
                <line x1={guide.value} x2={guide.value} y1="0" y2={geometry.height} />
              ) : (
                <line x1="0" x2={geometry.width} y1={guide.value} y2={guide.value} />
              )}
              <rect
                x={guide.axis === "x" ? Math.min(guide.value + 10, geometry.width - 220) : 12}
                y={guide.axis === "y" ? Math.max(guide.value - 31, 6) : 10}
                width="208"
                height="26"
                rx="6"
              />
              <text
                x={guide.axis === "x" ? Math.min(guide.value + 20, geometry.width - 210) : 22}
                y={guide.axis === "y" ? Math.max(guide.value - 13, 24) : 28}
              >
                {guide.label}
              </text>
            </g>
          ))}
        </svg>
        </div>
      </div>
    </div>
  );
}
