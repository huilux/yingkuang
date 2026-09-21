import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import {
  calculateGeometry,
  globalToRegion,
  layerPosition,
  resolveLayerText,
} from "./editor-model";
import type { EditorDocument, PhotoAsset, Rect, RegionId, WatermarkLayer } from "./types";

type Guide = {
  axis: "x" | "y";
  value: number;
  label: string;
  tone: "canvas" | "region" | "photo";
};

type DragState = {
  layerId: string;
  pointerId: number;
};

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
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const geometry = useMemo(() => calculateGeometry(photo, document), [document, photo]);
  const selectedLayer = document.layers.find((item) => item.id === selectedLayerId);
  const selectedRegion = selectedLayer?.region ?? "canvas";
  const selectedBounds = geometry.regions[selectedRegion];

  function clientPoint(event: PointerEvent<SVGSVGElement>) {
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
    if (!drag) return;
    const layer = document.layers.find((item) => item.id === drag.layerId);
    const point = clientPoint(event);
    if (!layer || !point) return;
    const snapped = snapPoint(layer, point);
    const local = globalToRegion(snapped.point.x, snapped.point.y, layer.region, geometry);
    setGuides(snapped.guides);
    onLayerPreview(layer.id, local);
  }

  function finishDrag(event: PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    try {
      svgRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released if the window lost focus.
    }
    dragRef.current = null;
    setGuides([]);
    onDragEnd();
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -5 : 5;
    onZoomChange(Math.max(20, Math.min(300, zoom + delta)));
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
    <div className="canvas-viewport" onWheel={handleWheel}>
      <div
        className="preview-scale svg-preview"
        style={{
          width: `${Math.max(420, Math.min(860, geometry.width * 0.48)) * zoom / 100}px`,
        }}
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
          </defs>

          <rect width={geometry.width} height={geometry.height} fill={document.frame.color} />
          {document.frame.type === "blur" && (
            <>
              <image
                href={photo.thumbnailDataUrl}
                x={-geometry.width * 0.08}
                y={-geometry.height * 0.08}
                width={geometry.width * 1.16}
                height={geometry.height * 1.16}
                preserveAspectRatio="xMidYMid slice"
                filter="url(#background-blur)"
              />
              <rect width={geometry.width} height={geometry.height} fill="#101312" opacity="0.08" />
            </>
          )}
          <g filter={document.frame.shadow ? "url(#photo-shadow)" : undefined}>
            <image
              href={photo.thumbnailDataUrl}
              {...geometry.photo}
              preserveAspectRatio="none"
              clipPath="url(#photo-clip)"
            />
          </g>

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
                  event.stopPropagation();
                  onSelectLayer(item.id);
                  onDragStart();
                  dragRef.current = { layerId: item.id, pointerId: event.pointerId };
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
  );
}
