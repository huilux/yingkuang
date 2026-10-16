import { useEffect, useId, useState } from "react";
import { calculateGeometry } from "./editor-model";
import { measureBrowserLayers } from "./browser-layout";
import { ensureFontsLoaded, fontsChangedEvent } from "./font-library";
import { isVisible, regionNames } from "./canvas-camera";
import { distributionMetrics } from "./selection-model";
import { NumericInput } from "./NumericInput";
import { SelectControl } from "./SelectControl";
import { Segmented } from "./EditorControls";
import type { DistributionRange, EditorDocument, PhotoAsset } from "./types";

type Reference = DistributionRange["reference"];
type Props = {
  document: EditorDocument; photo: PhotoAsset; ids: string[];
  onRange: (axis: "x" | "y", reference: Reference, ratio: number | null, record?: boolean) => void;
  onReference: (reference: Reference) => void;
  onStart: () => void; onEnd: () => void;
};

const percent = (ratio: number) => Math.round(ratio * 1000) / 10;

export function DistributionControls({document: design, photo, ids, onRange, onReference, onStart, onEnd}: Props) {
  const helpId = useId();
  const [preferred, setPreferred] = useState<Reference | "region">("region");
  const [preferredAxis, setPreferredAxis] = useState<"x" | "y">();
  const [feedback, setFeedback] = useState<Partial<Record<"x" | "y", string>>>({});
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
  const ruleFor = (axis: "x" | "y") => design.distributions?.find(rule => rule.axis === axis && rule.layerIds.length === ids.length && rule.layerIds.every(id => ids.includes(id)));
  const spread = (axis: "x" | "y") => measured.length ? Math.max(...measured.map(item => item.position[axis])) - Math.min(...measured.map(item => item.position[axis])) : 0;
  const automaticAxis = ruleFor("x") && !ruleFor("y") ? "x" : ruleFor("y") && !ruleFor("x") ? "y" : spread("y") > spread("x") ? "y" : "x";
  const axis = preferredAxis ?? automaticAxis;
  const storedReference = ruleFor(axis)?.range?.reference ?? ruleFor(axis === "x" ? "y" : "x")?.range?.reference;
  const reference = storedReference ?? preferred;
  const actualReference = reference === "region" ? (layers.every(layer => layer.region === layers[0]?.region) ? layers[0]?.region ?? "canvas" : "canvas") : reference;
  const available = (value: Reference) => value === "photo" || value === "canvas" || (design.regions[value].enabled && geometry.regions[value].width > 0 && geometry.regions[value].height > 0);
  const labelFor = (value: Reference) => value === "photo" ? "照片" : regionNames[value];

  return <section className="distribution-controls" aria-label="分布范围">
    <div className="distribution-heading"><strong>分布范围</strong><span>保持字号，调整间距</span></div>
    <Segmented label="分布方向" value={axis} options={[{value:"x",label:"横向（宽度）"},{value:"y",label:"纵向（高度）"}]} onChange={next=>{onEnd();setPreferredAxis(next);setFeedback({});}} />
    <label className="field"><span>范围参照</span><SelectControl aria-label="范围参照" value={reference} disabled={!allVisible} onChange={event => {
      const value = event.currentTarget.value as Reference | "region";
      const next = value === "region" ? (layers.every(layer => layer.region === layers[0]?.region) ? layers[0]?.region ?? "canvas" : "canvas") : value;
      setPreferred(value); setFeedback({}); onReference(next);
    }}>
      <option value="region">所属区域（混选时为画布）</option><option value="photo">照片</option><option value="canvas">整个画布</option>
      {(["top", "bottom", "left", "right"] as const).map(value => <option key={value} value={value} disabled={!available(value)}>{regionNames[value]}</option>)}
    </SelectControl></label>
    {[axis].map(axis => {
      const label = axis === "x" ? "占用宽度" : "占用高度";
      const range = ruleFor(axis)?.range;
      const axisReference = range?.reference ?? actualReference;
      const metrics = distributionMetrics(axis, axisReference, measured, geometry, design.regions);
      const minimum = Math.max(.1, Math.ceil((metrics?.minimumRatio ?? 0) * 1000 - 1e-7) / 10);
      const value = percent(range?.ratio ?? metrics?.ratio ?? 0);
      const disabled = !allVisible || !metrics || minimum > 100;
      const direction = axis === "x" ? "横向" : "纵向";
      const notice = !allVisible ? "请选择至少两个可见元素。" : !metrics ? "参照区域不可用，请更换范围参照。" : minimum > 100 ? `${direction}排列至少需要 ${minimum}% 的范围，请更换参照或减小字号。` : range && range.ratio + 1e-9 < metrics.minimumRatio ? `当前${direction}排列至少需要 ${minimum}%，本照片已扩大范围；模板目标仍为 ${value}%。` : feedback[axis] || undefined;
      return <fieldset className="distribution-axis" key={axis} aria-describedby={`${helpId}-${axis}`}>
        <legend>{label}<span className="distribution-mode">{range ? `固定比例 · ${labelFor(axisReference)}` : "当前范围"}</span></legend>
        <div className="distribution-inputs">
          <input type="range" aria-label={label} min={.1} max={100} step={.1} value={Math.max(.1, Math.min(100, value))} disabled={disabled}
            onPointerDown={onStart} onPointerUp={onEnd} onPointerCancel={onEnd} onBlur={onEnd}
            onKeyDown={event => { if (event.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(event.key)) onStart(); }} onKeyUp={onEnd}
            onChange={event => { const requested=Number(event.currentTarget.value), next=Math.max(minimum,requested); setFeedback(current=>({...current,[axis]:next>requested?`已采用最小范围 ${minimum}%。`:""})); onRange(axis,axisReference,next/100,false); }} />
          <span className="distribution-percent"><NumericInput label={`${label}百分比`} value={value} min={.1} max={Math.max(100,value)} step={.1} disabled={disabled}
            normalize={next=>Math.round(next*10)/10}
            isValid={next=>{const valid=next>=minimum && next<=100;setFeedback(current=>({...current,[axis]:valid?"":`请输入 ${minimum}%–100% 之间的比例。`}));return valid;}}
            onCommit={next=>{setFeedback(current=>({...current,[axis]:""}));onRange(axis,axisReference,next/100);}} /><span aria-hidden="true">%</span></span>
        </div>
        <div className="distribution-footer"><small id={`${helpId}-${axis}`} className={notice?"distribution-notice":""} aria-live="polite">{notice ?? (range ? `最小范围 ${minimum}%。` : `调整后${axis === "x" ? "横向" : "纵向"}等间距排列，最小 ${minimum}%。`)}</small>
          {range && <button type="button" className="restore-field" aria-label={`恢复${label}当前范围`} onClick={()=>{setFeedback(current=>({...current,[axis]:""}));onRange(axis,axisReference,null);}}>恢复当前范围</button>}
        </div>
      </fieldset>;
    })}
  </section>;
}
