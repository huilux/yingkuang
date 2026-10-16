import { useEffect, useId, useState } from "react";
import { calculateGeometry } from "./editor-model";
import { measureBrowserLayers } from "./browser-layout";
import { ensureFontsLoaded, fontsChangedEvent } from "./font-library";
import { isVisible } from "./canvas-camera";
import { canPositionAlongAxis, distributionMetrics, selectionLineAxis } from "./selection-model";
import { NumericInput } from "./NumericInput";
import type { EditorDocument, PhotoAsset } from "./types";

type Props = {
  document: EditorDocument;
  photo: PhotoAsset;
  ids: string[];
  onRange: (axis: "x" | "y", ratio: number, record?: boolean) => void;
  onClear: () => void;
  onStart: () => void;
  onEnd: () => void;
};

const percent = (ratio: number) => Math.round(ratio * 1000) / 10;

export function DistributionControls({document: design, photo, ids, onRange, onClear, onStart, onEnd}: Props) {
  const helpId = useId();
  const [feedback, setFeedback] = useState("");
  const [, refreshFonts] = useState(0);
  const layers = design.layers.filter(layer => ids.includes(layer.id));
  const families = JSON.stringify([...new Set(layers.filter(layer => isVisible(layer, design.regions)).map(layer => layer.fontFamily))]);
  useEffect(() => {
    let alive = true;
    const load = () => { void ensureFontsLoaded(JSON.parse(families)).then(() => { if (alive) refreshFonts(value => value + 1); }).catch(() => {}); };
    load(); window.addEventListener(fontsChangedEvent, load);
    return () => { alive = false; window.removeEventListener(fontsChangedEvent, load); };
  }, [families]);
  const geometry = calculateGeometry(photo, design);
  const measured = measureBrowserLayers(design, photo, ids);
  const allVisible = measured.length === ids.length && ids.length >= 2;
  const axis = allVisible ? selectionLineAxis(measured) : null;
  useEffect(() => { setFeedback(""); }, [axis]);
  const matches = (rule: {layerIds: string[]}) => rule.layerIds.length === ids.length && rule.layerIds.every(id => ids.includes(id));
  const range = design.distributions?.find(rule => rule.axis === axis && matches(rule))?.range;
  const hasRange = design.distributions?.some(rule => matches(rule) && rule.range);
  const metrics = axis ? distributionMetrics(axis, "canvas", measured, geometry, design.regions) : null;
  const minimum = Math.max(.1, Math.ceil((metrics?.minimumRatio ?? 0) * 1000 - 1e-7) / 10);
  const value = percent(metrics?.ratio ?? 0);
  const label = axis === "x" ? "占用宽度" : "占用高度";
  const dimension = axis === "x" ? "宽度" : "高度";
  const positionable = axis !== null && canPositionAlongAxis(axis, layers, geometry);
  const disabled = !metrics || minimum > 100 || !positionable;
  const overflow = range?.reference === "canvas" && metrics && range.ratio + 1e-9 < metrics.minimumRatio;
  const notice = !allVisible ? "请选择至少两个可见元素。" : !axis ? "选中的元素不是同一行或同一列。请先以所选元素为参照对齐，再调整范围。" : !positionable ? `所选元素的所属区域${dimension}不足，请增加${axis === "x" ? "左右" : "上下"}留白或对应区域的额外空间。` : minimum > 100 ? `文字总${dimension}已超过画布，请先减小字号或减少元素。` : feedback || (overflow ? `模板目标 ${percent(range.ratio)}%，当前文字至少需要 ${minimum}%，已按最小范围排布。` : "");

  return <section className="distribution-controls" aria-label="分布范围">
    <div className="distribution-heading"><strong>分布范围</strong><span>{axis === "x" ? "一行 · 调整宽度" : axis === "y" ? "一列 · 调整高度" : "混排不可调整"}</span></div>
    {axis && <>
      <p className="selection-note">{axis === "x" ? "只调整水平间距，字号和行高保持不变。" : "只调整纵向间距，字号和列宽保持不变。"}</p>
      <fieldset className="distribution-axis" key={axis} aria-describedby={helpId}>
        <legend>{label}<span className="distribution-mode">画布{dimension}的百分比</span></legend>
        <div className="distribution-inputs">
          <input type="range" aria-label={label} min={Math.min(minimum, 100)} max={100} step={.1} value={Math.max(Math.min(minimum, 100), Math.min(100, value))} disabled={disabled}
            onPointerDown={onStart} onPointerUp={onEnd} onPointerCancel={onEnd} onBlur={onEnd}
            onKeyDown={event => { if (event.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(event.key)) onStart(); }} onKeyUp={onEnd}
            onChange={event => { setFeedback(""); onRange(axis, Number(event.currentTarget.value) / 100, false); }} />
          <span className="distribution-percent"><NumericInput label={`${label}百分比`} value={value} min={.1} max={Math.max(100,value)} step={.1} disabled={disabled}
            normalize={next=>Math.round(next*10)/10}
            isValid={next=>{const valid=next>=minimum && next<=100;setFeedback(valid ? "" : `请输入 ${minimum}%–100% 之间的比例。`);return valid;}}
            onCommit={next=>{setFeedback("");onRange(axis,next/100);}} /><span aria-hidden="true">%</span></span>
        </div>
      </fieldset>
    </>}
    <div className="distribution-footer"><small id={helpId} className={notice ? "distribution-notice" : ""} aria-live="polite">{notice || `按文字边缘等间距，最小 ${minimum}%。`}</small>
      {hasRange && <button type="button" className="restore-field" aria-label="解除固定范围" onClick={()=>{setFeedback("");onClear();}}>解除固定范围</button>}
    </div>
  </section>;
}
