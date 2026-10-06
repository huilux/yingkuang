import { useState } from "react";
import { Eye, EyeSlash, TextT, Trash } from "@phosphor-icons/react";
import { calculateGeometry, metadataOptionForSource, metadataValue, resolveLayerText } from "./editor-model";
import { isVisible, regionNames } from "./canvas-camera";
import { SliderRow, Segmented } from "./EditorControls";
import { NumericInput } from "./NumericInput";
import { ParameterPicker } from "./ParameterPicker";
import { positionPatch, type AlignReference, type ArrangeAction, type LayerPatch } from "./selection-model";
import type { EditorDocument, LayerSource, PhotoAsset, RegionId, WatermarkLayer } from "./types";

// Coordinate percentages become f32 normalized positions in the native renderer.
const isValidCoordinate = (percent: number) => Number.isFinite(Math.fround(percent / 100));

type Props = {
  document: EditorDocument;
  photo?: PhotoAsset;
  selectedIds: string[];
  onSelect: (id: string, extend: boolean) => void;
  onSelectionChange: (ids: string[]) => void;
  onPatch: (patches: LayerPatch[], record?: boolean) => void;
  onAdd: (source: LayerSource) => void;
  onDelete: () => void;
  onStart: () => void;
  onEnd: () => void;
  onOverride: (source: LayerSource, value?: string) => void;
  onArrange: (action: ArrangeAction, reference: AlignReference) => void;
};

export function LayerInspector({ document: design, photo, selectedIds, onSelect, onSelectionChange, onPatch, onAdd, onDelete, onStart, onEnd, onOverride, onArrange }: Props) {
  const [reference, setReference] = useState<AlignReference | "region">("region");
  const layers = design.layers.filter(layer => selectedIds.includes(layer.id));
  const first = layers[0];
  const single = layers.length === 1;
  const mixed = (key: keyof WatermarkLayer) => layers.some(layer => layer[key] !== first?.[key]);
  const patch = (values: Partial<WatermarkLayer>, record = true) => onPatch(layers.map(layer => ({ id: layer.id, patch: values })), record);
  const geometry = photo ? calculateGeometry(photo, design) : null;
  const available = (id: RegionId) => id === "canvas" || (design.regions[id].enabled && !!geometry && geometry.regions[id].width >= 1 && geometry.regions[id].height >= 1);
  const actualReference = reference === "region" ? (mixed("region") ? "canvas" : first?.region ?? "canvas") : reference;
  const canArrange = layers.length > 0 && layers.every(layer => isVisible(layer, design.regions)) && (actualReference === "photo" || actualReference === "selection" || available(actualReference));
  const verticalThirds = actualReference === "left" || actualReference === "right";
  const arrange = (action: ArrangeAction) => onArrange(action, actualReference);
  const selectedSource = single && first.source !== "custom" ? metadataOptionForSource(first.source) : null;

  function assignRegion(region: RegionId) {
    if (!photo || !layers.length) return;
    const geometry = calculateGeometry(photo, design);
    const points = layers.map(layer => {
      const bounds = geometry.regions[layer.region];
      return { x: bounds.x + layer.x * bounds.width, y: bounds.y + layer.y * bounds.height };
    });
    const target = geometry.regions[region];
    if (target.width < 1 || target.height < 1) return;
    const center = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
    onPatch(layers.map((layer, index) => {
      const point = region === "canvas" ? points[index] : { x: target.x + target.width / 2 + points[index].x - center.x, y: target.y + target.height / 2 + points[index].y - center.y };
      return { id: layer.id, patch: { ...positionPatch({ ...layer, region }, point, geometry).patch, region } };
    }));
    setReference("region");
  }

  return <div className="inspector-scroll" id="panel-watermark" role="tabpanel" aria-labelledby="tab-watermark">
    <section className="inspector-section layer-section">
      <div className="section-heading layer-heading"><strong>水印图层</strong><ParameterPicker photo={photo} onAdd={onAdd} /></div>
      <div className="selection-toolbar"><span>Shift 点选多选{layers.length > 0 ? ` · 已选 ${layers.length} 项` : ""}</span><button type="button" onClick={() => onSelectionChange(design.layers.filter(layer => isVisible(layer, design.regions)).map(layer => layer.id))}>全选</button><button type="button" disabled={!layers.length} onClick={() => onSelectionChange([])}>清除</button></div>
      <div className="layer-list">{design.layers.map(item => <div className={`layer-row ${selectedIds.includes(item.id) ? "selected" : ""}`} key={item.id}>
        <button className="layer-main" type="button" aria-pressed={selectedIds.includes(item.id)} aria-label={`选择图层 ${item.name}`} onClick={event => onSelect(item.id, event.shiftKey)}><TextT /><span><strong>{item.name}</strong><small>{item.region !== "canvas" && !design.regions[item.region].enabled ? "区域已关闭 · 开启后恢复" : photo ? resolveLayerText(item, photo) : ""}</small></span></button>
        <button className="layer-visibility" type="button" aria-label={`${item.visible ? "隐藏" : "显示"}${item.name}`} onClick={() => onPatch([{ id: item.id, patch: { visible: !item.visible } }])}>{item.visible ? <Eye /> : <EyeSlash />}</button>
      </div>)}</div>
    </section>
    {first && photo ? <section className="inspector-section selected-layer-panel">
      <div className="section-heading"><strong>{single ? first.name : `已选择 ${layers.length} 个元素`}</strong><button type="button" className="danger-action" onClick={onDelete}><Trash /> 删除</button></div>
      {single && (first.source === "custom" ? <label className="field"><span>文字内容</span><input className="text-input" maxLength={2000} value={first.customValue} onChange={event => patch({ customValue: event.currentTarget.value })} /></label> : <div className="field"><label><span>当前照片显示值</span><input className="text-input" maxLength={2000} value={photo.overrides?.[first.source] ?? metadataValue(photo, first.source) ?? ""} placeholder="未读取到，可手动补充" onChange={event => onOverride(first.source, event.currentTarget.value)} /></label>{selectedSource && <small className="metadata-source">来源：{selectedSource.sourceLabel}</small>}<button className="restore-field" type="button" disabled={photo.overrides?.[first.source] === undefined} onClick={() => onOverride(first.source)}>恢复原值</button></div>)}
      {!single && <p className="selection-note">样式修改应用到全部所选元素；内容保留各自的值。</p>}
      <label className="field"><span>所属区域</span><select value={mixed("region") ? "" : first.region} onChange={event => assignRegion(event.currentTarget.value as RegionId)}>
        {mixed("region") && <option value="" disabled>多个区域</option>}
        {(Object.keys(regionNames) as RegionId[]).map(id => <option key={id} value={id} disabled={!available(id)}>{regionNames[id]}{id !== "canvas" && !design.regions[id].enabled ? "（未启用）" : ""}</option>)}
      </select></label>
      <label className="field"><span>对齐参照</span><select aria-label="对齐参照" value={reference} onChange={event => setReference(event.currentTarget.value as AlignReference | "region")}>
        <option value="region">所属区域（混选时为画布）</option><option value="selection">所选元素</option><option value="canvas">整个画布</option><option value="photo">照片</option>
        {(["top", "bottom", "left", "right"] as const).map(id => <option key={id} value={id} disabled={!available(id)}>{regionNames[id]}</option>)}
      </select></label>
      <div className="align-grid">
        {([["left", "左对齐"], ["right", "右对齐"], ["center-x", "水平居中"], ["center-y", "垂直居中"], ["top", "顶部对齐"], ["bottom", "底部对齐"]] as const).map(([action, label]) => <button key={action} type="button" disabled={!canArrange} onClick={() => arrange(action)}>{label}</button>)}
        <button type="button" disabled={!canArrange} onClick={() => arrange("third-1")}>第 1 {verticalThirds ? "列" : "行"} · 1/3</button><button type="button" disabled={!canArrange} onClick={() => arrange("third-2")}>第 2 {verticalThirds ? "列" : "行"} · 2/3</button>
        <button type="button" disabled={!canArrange || layers.length < 3} title="至少选择三个元素，保持两端位置并均分文字边界间的空隙" onClick={() => arrange("distribute-x")}>横向等间距</button><button type="button" disabled={!canArrange || layers.length < 3} title="至少选择三个元素，保持两端位置并均分文字边界间的空隙" onClick={() => arrange("distribute-y")}>纵向等间距</button>
      </div>
      <p className="selection-note">{reference === "selection" ? "逐项对齐到所选元素的共同边界。" : "整体对齐到参照，保持元素间相对位置。"}{!canArrange ? "隐藏元素或关闭的区域不参与画布排版。" : ""}</p>
      <label className="field"><span>字体</span><select value={mixed("fontFamily") ? "" : first.fontFamily} onChange={event => patch({ fontFamily: event.currentTarget.value })}>{mixed("fontFamily") && <option value="" disabled>多种字体</option>}<option value="Noto Sans CJK SC, sans-serif">Noto Sans 思源黑体</option><option value="Noto Serif CJK SC, serif">Noto Serif 思源宋体</option><option value="DejaVu Sans, sans-serif">DejaVu Sans</option><option value="Liberation Sans, sans-serif">Liberation Sans</option><option value="monospace">等宽字体</option></select></label>
      {mixed("fontSize") && <p className="selection-note">字号不同；调整后统一。</p>}
      <SliderRow label="字号" value={first.fontSize} min={8} max={120} onStart={onStart} onEnd={onEnd} onChange={value => patch({ fontSize: value }, false)} />
      <label className="field"><span>字重</span><select value={mixed("fontWeight") ? "" : first.fontWeight} onChange={event => patch({ fontWeight: Number(event.currentTarget.value) as WatermarkLayer["fontWeight"] })}>{mixed("fontWeight") && <option value="" disabled>多种字重</option>}<option value="400">常规</option><option value="500">中等</option><option value="600">半粗</option><option value="700">粗体</option></select></label>
      <label className="field color-field"><span>文字颜色{mixed("color") ? " · 多种" : ""}</span><span className="color-input-wrap"><input type="color" value={first.color} onChange={event => patch({ color: event.currentTarget.value })} /><code>{mixed("color") ? "多种颜色" : first.color.toUpperCase()}</code></span></label>
      {mixed("opacity") && <p className="selection-note">透明度不同；调整后统一。</p>}
      <SliderRow label="透明度" value={Math.round(first.opacity * 100)} min={0} max={100} suffix="%" onStart={onStart} onEnd={onEnd} onChange={value => patch({ opacity: value / 100 }, false)} />
      <Segmented label="文字方向" value={mixed("rotation") ? "" : String(first.rotation)} options={[{ value: "0", label: "横排" }, { value: "-90", label: "左转" }, { value: "90", label: "右转" }]} onChange={value => patch({ rotation: Number(value) as WatermarkLayer["rotation"] })} />
      {single && <><div className="coordinate-inputs"><label>X · 区域 %<NumericInput key={`${first.id}-x`} label="X 坐标" isValid={isValidCoordinate} value={Number((first.x * 100).toFixed(2))} step={0.1} onCommit={value => patch({ x: value / 100 })} /></label><label>Y · 区域 %<NumericInput key={`${first.id}-y`} label="Y 坐标" isValid={isValidCoordinate} value={Number((first.y * 100).toFixed(2))} step={0.1} onCommit={value => patch({ y: value / 100 })} /></label></div><div className="coordinate-readout"><span>X {(first.x * 100).toFixed(1)}%</span><span>Y {(first.y * 100).toFixed(1)}%</span></div>{(first.x < 0 || first.x > 1 || first.y < 0 || first.y > 1) && <p className="selection-note">元素已移出所属区域；仍随该区域布局，可对齐居中找回。</p>}</>}
    </section> : <section className="inspector-section muted-section"><strong>选择画布中的文字</strong><p>Shift 点选多个元素，可整体拖动、对齐或等间距分布。拖动时按 Ctrl 临时关闭吸附。</p></section>}
  </div>;
}
