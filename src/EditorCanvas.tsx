import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useId, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Group, Image as CanvasImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import { calculateGeometry, layerPosition, resolveLayerText } from "./editor-model";
import { baseScale, clampZoom, fitCamera, isVisible, regionNames, safeRect, snapSelection, zoomAt, type Camera, type Guide, type Point } from "./canvas-camera";
import { usePreviewBackdrop } from "./use-preview-backdrop";
import { useEditorPhoto } from "./use-editor-photo";
import { arrangeSelection, moveSelection, positionPatch, selectLayer, unionBounds, type AlignReference, type ArrangeAction, type LayerPatch, type MeasuredLayer } from "./selection-model";
import type { EditorDocument, PhotoAsset, WatermarkLayer, Rect as SceneRect, RegionId } from "./types";

export interface EditorCanvasHandle {
  setZoom: (zoom: number) => void;
  fit: () => void;
  isInteracting: () => boolean;
  arrange: (action: ArrangeAction, reference: AlignReference) => void;
}
export interface EditorCanvasProps {
  photo: PhotoAsset;
  document: EditorDocument;
  selectedLayerIds: string[];
  snapEnabled: boolean;
  onZoomChange: (zoom: number) => void;
  onSelectionChange: (ids: string[]) => void;
  onLayersCommit: (patches: LayerPatch[]) => void;
}

// React owns document changes. Konva owns transient camera/drag positions.
// These must not be sent through the document store on each input event.
export const EditorCanvas = memo(forwardRef<EditorCanvasHandle, EditorCanvasProps>(function EditorCanvas({
  photo, document: design, selectedLayerIds, snapEnabled, onZoomChange, onSelectionChange, onLayersCommit,
}, ref) {
  const helpId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const backgroundRef = useRef<Konva.Group>(null);
  const objectsRef = useRef<Konva.Group>(null);
  const overlayRef = useRef<Konva.Group>(null);
  const selectionRef = useRef<Konva.Group>(null);
  const selectionIds = useRef(selectedLayerIds);
  selectionIds.current = selectedLayerIds;
  const guidesRef = useRef<Konva.Group>(null);
  const camera = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const fitted = useRef(true);
  const zoomFrame = useRef<number | null>(null);
  const drag = useRef<{ node: Konva.Group; items: { node: Konva.Group; layer: WatermarkLayer; origin: Point }[]; bounds: SceneRect; regions: { id: RegionId; bounds: SceneRect }[]; others: { bounds: SceneRect; name: string }[]; cancelled: boolean } | null>(null);
  const pan = useRef<{ pointerId: number; start: Point; origin: Camera } | null>(null);
  const spacePressed = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const previousSize = useRef(size);
  const geometry = useMemo(() => calculateGeometry(photo, design), [photo, design]);
  const { image, error } = usePreviewBackdrop(photo.thumbnailDataUrl, design.frame, geometry);
  const { image: editorPhoto, error: photoError, loading: photoLoading } = useEditorPhoto(photo);
  const clipPhoto = useCallback((context: Konva.Context) => {
    context.beginPath();
    context.roundRect(0, 0, geometry.photo.width, geometry.photo.height,
      Math.min(design.frame.radius * 2, geometry.photo.width / 2, geometry.photo.height / 2));
    context.closePath();
  }, [geometry.photo.width, geometry.photo.height, design.frame.radius]);
  const selectedLayers = design.layers.filter(layer => selectedLayerIds.includes(layer.id) && isVisible(layer, design.regions));
  const selectedRegions = [...new Set(selectedLayers.map(layer => layer.region))].filter(region => region !== "canvas");
  const visibleLayers = design.layers.filter(layer => isVisible(layer, design.regions));
  // Font readiness changes text measurement even if the document is unchanged.
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    const update = () => { if (alive) setFontRevision(value => value + 1); };
    void document.fonts.ready.then(update);
    document.fonts.addEventListener("loadingdone", update);
    return () => { alive = false; document.fonts.removeEventListener("loadingdone", update); };
  }, []);

  function reportZoom() {
    if (zoomFrame.current !== null) return;
    zoomFrame.current = requestAnimationFrame(() => {
      zoomFrame.current = null;
      onZoomChange(camera.current.scale / baseScale(geometry.width) * 100);
    });
  }
  function applyCamera(next: Camera) {
    camera.current = next;
    for (const world of [backgroundRef.current, objectsRef.current, overlayRef.current]) {
      world?.setAttrs({ x: next.x, y: next.y, scaleX: next.scale, scaleY: next.scale });
    }
    reportZoom();
  }
  function fit() {
    if (drag.current || pan.current || !size.width) return;
    fitted.current = true;
    applyCamera(fitCamera(size, geometry));
  }
  function setZoom(percent: number, anchor = { x: size.width / 2, y: size.height / 2 }) {
    if (drag.current || pan.current) return;
    fitted.current = false;
    applyCamera(zoomAt(camera.current, baseScale(geometry.width) * clampZoom(percent) / 100, anchor));
  }
  useImperativeHandle(ref, () => ({ setZoom, fit, isInteracting: () => !!drag.current || !!pan.current, arrange(action, reference) {
    if (drag.current || pan.current) return;
    const patches = arrangeSelection(action, reference, measureSelection(), design.layers, geometry);
    if (patches.length) onLayersCommit(patches);
  } }));

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!size.width || !size.height) return;
    if (fitted.current) applyCamera(fitCamera(size, geometry));
    else applyCamera({ ...camera.current,
      x: camera.current.x + (size.width - previousSize.current.width) / 2,
      y: camera.current.y + (size.height - previousSize.current.height) / 2,
    });
    previousSize.current = size;
  }, [size.width, size.height, geometry.width, geometry.height]);

  function selectedNodes(ids = selectionIds.current) {
    return objectsRef.current?.find<Konva.Group>((node: Konva.Node) => node.hasName("watermark-layer") && ids.includes(node.id())) ?? [];
  }
  function measureSelection(ids = selectionIds.current): MeasuredLayer[] {
    return selectedNodes(ids).map(node => ({ id: node.id(), position: node.position(),
      bounds: node.findOne<Konva.Text>("Text")!.getClientRect({ relativeTo: objectsRef.current! }) }));
  }
  function showSelection() {
    const group = selectionRef.current;
    if (!group) return;
    for (const node of selectedNodes()) {
      const text = node.findOne<Konva.Text>("Text");
      const box = group.findOne<Konva.Rect>((box: Konva.Node) => box.id() === `selection-${node.id()}`);
      if (!text || !box) continue;
      box.setAttrs({ visible: true, x: node.x(), y: node.y(), rotation: node.rotation(),
        width: text.width() + 16, height: text.height() + 12,
        offsetX: text.width() / 2 + 8, offsetY: text.height() / 2 + 6 });
    }
    const overall = group.findOne<Konva.Rect>(".selection-bounds");
    const bounds = unionBounds(measureSelection());
    overall?.setAttrs({ visible: selectedNodes().length > 1 && !!bounds, ...(bounds ?? {}) });
  }
  useLayoutEffect(() => { showSelection(); }, [selectedLayerIds, design, photo, fontRevision, size.width]);

  function showGuides(guides: Guide[]) {
    const container = guidesRef.current;
    if (!container) return;
    for (const axis of ["x", "y"] as const) {
      const group = container.findOne<Konva.Group>(`.guide-${axis}`)!;
      const guide = guides.find(item => item.axis === axis);
      group.visible(!!guide);
      if (!guide) continue;
      group.findOne<Konva.Line>("Line")!.setAttrs({ stroke: guide.color,
        points: axis === "x" ? [guide.value, 0, guide.value, geometry.height] : [0, guide.value, geometry.width, guide.value] });
      group.findOne<Konva.Text>("Text")!.setAttrs({ text: guide.label, fill: guide.color,
        x: axis === "x" ? guide.value + 10 : 12, y: axis === "y" ? Math.max(0, guide.value - 28) : 10 });
    }
  }
  function cancelDrag() {
    const active = drag.current;
    if (!active) return;
    active.cancelled = true;
    active.items.forEach(item => item.node.position(item.origin));
    active.node.stopDrag();
    showSelection();
    showGuides([]);
    drag.current = null;
  }
  function stopPan(cancel = false) {
    const active = pan.current;
    if (!active) return;
    pan.current = null;
    if (cancel) applyCamera(active.origin);
    if (viewportRef.current?.hasPointerCapture(active.pointerId)) viewportRef.current.releasePointerCapture(active.pointerId);
    if (viewportRef.current) viewportRef.current.style.cursor = spacePressed.current ? "grab" : "";
  }

  // Non-passive wheel handling suppresses browser zoom. Ordinary wheel pans the
  // camera, including horizontal trackpad input, without any scrollable mega DOM.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (drag.current || pan.current) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      if (event.ctrlKey || event.metaKey) {
        if (!event.deltaY) return;
        const bounds = viewport.getBoundingClientRect();
        const zoom = camera.current.scale / baseScale(geometry.width) * 100;
        setZoom(zoom * Math.exp(-event.deltaY * unit * 0.0015), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      } else {
        fitted.current = false;
        const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        applyCamera({ ...camera.current, x: camera.current.x - dx * unit, y: camera.current.y - dy * unit });
      }
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [size.height, geometry.width, onZoomChange]);

  useEffect(() => {
    const blur = () => { cancelDrag(); stopPan(); spacePressed.current = false; if (viewportRef.current) viewportRef.current.style.cursor = ""; };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      if (drag.current) { drag.current.cancelled = true; drag.current.node.stopDrag(); drag.current = null; }
      if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
    };
  }, []);

  function select(id: string, extend: boolean) {
    viewportRef.current?.focus({ preventScroll: true });
    const next = selectLayer(selectionIds.current, id, extend, true);
    selectionIds.current = next;
    onSelectionChange(next);
  }
  function startDrag(node: Konva.Group) {
    const items = selectedNodes().map(item => ({ node: item, layer: design.layers.find(layer => layer.id === item.id())!, origin: item.position() }));
    const bounds = unionBounds(measureSelection());
    if (!bounds || !items.some(item => item.node === node)) { node.stopDrag(); return; }
    const regions = [...new Set(items.map(item => item.layer.region))].filter(id => id !== "canvas")
      .map(id => ({ id, bounds: safeRect(geometry.regions[id], design.regions[id].safePadding) }));
    const others = measureSelection(visibleLayers.filter(layer => !selectionIds.current.includes(layer.id)).map(layer => layer.id))
      .map(item => ({ bounds: item.bounds, name: design.layers.find(layer => layer.id === item.id)!.name }));
    drag.current = { node, items, bounds, regions, others, cancelled: false };
    showSelection();
  }
  function moveDrag(node: Konva.Group, event: MouseEvent | TouchEvent) {
    const active = drag.current;
    const primary = active?.items.find(item => item.node === node);
    if (!active || !primary) return;
    const delta = { x: node.x() - primary.origin.x, y: node.y() - primary.origin.y };
    const snapped = snapSelection(active.bounds, delta, geometry, active.regions, active.others, camera.current.scale, snapEnabled && !event.ctrlKey && !event.metaKey);
    active.items.forEach(item => item.node.position({ x: item.origin.x + snapped.delta.x, y: item.origin.y + snapped.delta.y }));
    showSelection(); showGuides(snapped.guides);
  }
  function commitMove() {
    const active = drag.current;
    showGuides([]);
    drag.current = null;
    if (!active || active.cancelled) return;
    const patches = active.items.filter(item => Math.abs(item.node.x() - item.origin.x) > 1e-9 || Math.abs(item.node.y() - item.origin.y) > 1e-9)
      .map(item => positionPatch(item.layer, item.node.position(), geometry));
    if (patches.length) onLayersCommit(patches);
  }

  return <div className="canvas-viewport design-canvas" ref={viewportRef} tabIndex={0} role="group"
    aria-label={`${photo.fileName} 的相框设计画布`} aria-describedby={helpId} title="Ctrl + 滚轮缩放 · 滚轮平移 · 空格或中键拖动平移"
    onBlur={event => { spacePressed.current = false; if (!pan.current) event.currentTarget.style.cursor = ""; }}
    onContextMenu={event => event.preventDefault()}
    onPointerDownCapture={event => {
      if (!event.isPrimary || drag.current || pan.current) return;
      if (event.button !== 0 && event.button !== 1) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const hit = stageRef.current?.getIntersection(point);
      if (event.button === 1 || spacePressed.current || !hit) {
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        if (event.button === 0 && !spacePressed.current) onSelectionChange([]);
        fitted.current = false;
        pan.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { ...camera.current } };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.style.cursor = "grabbing";
      }
    }}
    onPointerMove={event => {
      const active = pan.current;
      if (!active || active.pointerId !== event.pointerId) return;
      applyCamera({ ...active.origin, x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y });
    }}
    onPointerUp={event => { if (pan.current?.pointerId === event.pointerId) stopPan(); }}
    onPointerCancel={() => { stopPan(true); cancelDrag(); }}
    onLostPointerCapture={() => stopPan()}
    onKeyDown={event => {
      if (event.code === "Space") { event.preventDefault(); spacePressed.current = true; event.currentTarget.style.cursor = "grab"; return; }
      if (event.key === "Escape") { const moving = !!drag.current || !!pan.current; cancelDrag(); stopPan(true); if (!moving) onSelectionChange([]); event.stopPropagation(); return; }
      if (drag.current || pan.current || !selectedLayers.length || event.ctrlKey || event.metaKey || event.altKey) return;
      const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      onLayersCommit(moveSelection(selectedLayers, geometry, { x: direction.x * step, y: direction.y * step }));
    }}
    onKeyUp={event => { if (event.code === "Space") { spacePressed.current = false; event.currentTarget.style.cursor = pan.current ? "grabbing" : ""; } }}
  >
    <Stage className="konva-stage" ref={stageRef} width={size.width} height={size.height}>
      <Layer listening={false}>
        <Group ref={backgroundRef} name="background-world">
          <Rect width={geometry.width} height={geometry.height} fill={design.frame.color} />
          {image && <CanvasImage name="preview-backdrop" image={image} width={geometry.width} height={geometry.height} />}
          {editorPhoto && <Group x={geometry.photo.x} y={geometry.photo.y} clipFunc={clipPhoto}><CanvasImage name="preview-photo" image={editorPhoto} width={geometry.photo.width} height={geometry.photo.height} /></Group>}
        </Group>
      </Layer>
      <Layer>
        <Group ref={objectsRef} name="objects-world" clipX={0} clipY={0} clipWidth={geometry.width} clipHeight={geometry.height}>
          {visibleLayers.map(layer => <Watermark key={layer.id} layer={layer} text={resolveLayerText(layer, photo)}
            position={layerPosition(layer, geometry)} fontRevision={fontRevision}
            onSelect={extend => select(layer.id, extend)}
            onDragStart={startDrag}
            onDragMove={moveDrag}
            onDragEnd={commitMove} />)}
        </Group>
      </Layer>
      <Layer listening={false}>
        <Group ref={overlayRef} name="overlay-world" clipX={0} clipY={0} clipWidth={geometry.width} clipHeight={geometry.height}>
          {selectedRegions.map(region => <Group key={region}>
            <Rect {...geometry.regions[region]} fill="rgba(185,207,138,0.035)" stroke="rgba(185,207,138,0.72)" strokeWidth={1} strokeScaleEnabled={false} dash={[7, 7]} />
            <Text x={geometry.regions[region].x + 12} y={geometry.regions[region].y + 8} text={regionNames[region]} fontSize={17} fill="#b9cf8a" />
          </Group>)}
          <Group ref={selectionRef}>
            {selectedLayers.map(layer => <Rect key={layer.id} id={`selection-${layer.id}`} name="selection-box" fill="rgba(16,20,18,0.08)" stroke="#b9cf8a" strokeWidth={1.5} strokeScaleEnabled={false} cornerRadius={6} />)}
            <Rect name="selection-bounds" visible={false} stroke="#b9cf8a" strokeWidth={1} strokeScaleEnabled={false} dash={[6, 5]} />
          </Group>
          <Group ref={guidesRef}>
            {(["x", "y"] as const).map(axis => <Group name={`guide-${axis}`} key={axis} visible={false}>
              <Line strokeWidth={1} strokeScaleEnabled={false} dash={[7, 5]} />
              <Text fontSize={15} padding={4} />
            </Group>)}
          </Group>
        </Group>
      </Layer>
    </Stage>
    {!image && <div className="canvas-preview-status" role="status">{error ? "相框预览生成失败，请重新选择照片" : "正在生成相框预览…"}</div>}
    {image && error && <div className="canvas-preview-status" role="status">相框预览更新失败，请重新选择照片</div>}
    {image && (photoError || photoLoading) && <div className="canvas-photo-status" role="status">{photoError ? "高清照片读取失败，当前显示缩略图；请确认原文件仍可访问" : "正在加载高清照片…"}</div>}
    <span id={helpId} className="sr-only">Ctrl 加滚轮缩放，滚轮平移，空格加拖动或鼠标中键平移。Shift 点选可多选，Ctrl 拖动临时关闭吸附。可在右侧图层列表选择水印，聚焦画布后用方向键微调，Shift 加方向键移动十个单位，Escape 取消拖动。</span>
  </div>;
}));

function Watermark({ layer, text, position, fontRevision, onSelect, onDragStart, onDragMove, onDragEnd }: {
  layer: WatermarkLayer; text: string; position: Point; fontRevision: number; onSelect: (extend: boolean) => void;
  onDragStart: (node: Konva.Group) => void; onDragMove: (node: Konva.Group, event: MouseEvent | TouchEvent) => void; onDragEnd: (node: Konva.Group) => void;
}) {
  const textRef = useRef<Konva.Text>(null);
  const groupRef = useRef<Konva.Group>(null);
  const hitRef = useRef<Konva.Rect>(null);
  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node) return;
    // Re-measure loaded fonts, including CJK; never estimate with text.length.
    node.fontFamily(layer.fontFamily);
    node.offset({ x: node.width() / 2, y: node.height() / 2 });
    hitRef.current?.setAttrs({ x: -node.width() / 2 - 8, y: -node.height() / 2 - 6, width: node.width() + 16, height: node.height() + 12 });
  }, [text, layer.fontSize, layer.fontFamily, layer.fontWeight, fontRevision]);
  return <Group ref={groupRef} id={layer.id} name="watermark-layer" {...position} rotation={layer.rotation} draggable dragDistance={4}
    onMouseDown={event => { if (event.evt.button === 0) { onSelect(event.evt.shiftKey); if (event.evt.shiftKey) groupRef.current?.stopDrag(); } }} onTouchStart={() => onSelect(false)}
    onMouseEnter={event => { event.target.getStage()!.container().style.cursor = "grab"; }}
    onMouseLeave={event => { event.target.getStage()!.container().style.cursor = ""; }}
    onDragStart={event => onDragStart(event.target as Konva.Group)}
    onDragMove={event => onDragMove(event.target as Konva.Group, event.evt as MouseEvent | TouchEvent)}
    onDragEnd={event => onDragEnd(event.target as Konva.Group)}>
    <Rect ref={hitRef} fill="rgba(0,0,0,0)" />
    <Text key={fontRevision} ref={textRef} text={text} fontFamily={layer.fontFamily} fontSize={layer.fontSize} fontStyle={String(layer.fontWeight)}
      fill={layer.color} opacity={layer.opacity * (text.startsWith("未读取到") ? 0.55 : 1)} listening={false} />
  </Group>;
}
