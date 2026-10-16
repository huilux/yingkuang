import type { EditorDocument, FrameSettings, RegionSettings, TemplateRecord, WatermarkLayer } from "./types";

export type TemplateChange = {
  group: string;
  field: string;
  builtInValue: string;
  localValue: string;
};

const frameFields = [
  ["type", "背景类型"], ["color", "背景颜色"], ["blur", "模糊强度"],
  ["brightness", "背景亮度"], ["paddingX", "左右留白"], ["paddingY", "上下留白"],
  ["radius", "圆角"], ["shadow", "阴影"],
] as const satisfies ReadonlyArray<readonly [keyof FrameSettings, string]>;

const regionFields = [
  ["enabled", "启用"], ["extra", "区域宽度"],
  ["safePadding", "安全边距"], ["direction", "文字方向"],
] as const satisfies ReadonlyArray<readonly [keyof RegionSettings, string]>;

const layerFields = [
  ["name", "名称"], ["source", "内容来源"], ["customValue", "自定义文字"],
  ["region", "所在区域"], ["x", "横向位置"], ["y", "纵向位置"],
  ["fontFamily", "字体"], ["fontSize", "字号"], ["fontWeight", "字重"],
  ["color", "文字颜色"], ["opacity", "不透明度"], ["rotation", "旋转"],
  ["visible", "显示"],
] as const satisfies ReadonlyArray<readonly [keyof WatermarkLayer, string]>;

const regionNames = { top: "顶部区域", bottom: "底部区域", left: "左侧区域", right: "右侧区域" } as const;
const sourceNames: Partial<Record<WatermarkLayer["source"], string>> = {
  camera: "相机型号", lens: "镜头", focalLength: "焦距", aperture: "光圈",
  shutter: "快门", iso: "ISO", capturedAt: "拍摄时间", custom: "自定义文字",
};
const layerRegions: Record<WatermarkLayer["region"], string> = {
  canvas: "画布", top: "顶部", bottom: "底部", left: "左侧", right: "右侧",
};

function showValue(field: string, value: unknown): string {
  if (field === "cover") return typeof value === "string" && value.startsWith("data:image/") ? "本机照片封面" : String(value);
  if (field === "type") return value === "blur" ? "模糊背景" : "纯色背景";
  if (field === "source") return sourceNames[value as WatermarkLayer["source"]] ?? String(value).replace(/^exif:/, "EXIF ");
  if (field === "region") return layerRegions[value as WatermarkLayer["region"]];
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (field === "direction" || field === "rotation") return `${value}°`;
  if (field === "opacity") return `${Number((Number(value) * 100).toFixed(2))}%`;
  if (field === "brightness") return `${value}%`;
  return value === "" ? "（空）" : String(value);
}

function compareField(changes: TemplateChange[], group: string, field: string, label: string, builtInValue: unknown, localValue: unknown) {
  if (Object.is(builtInValue, localValue)) return;
  const before = showValue(field, builtInValue);
  const after = showValue(field, localValue);
  changes.push({ group, field: label, builtInValue: before, localValue: field === "cover" && before === after ? "另一张本机照片封面" : after });
}

function compareDocument(changes: TemplateChange[], orientation: string, builtIn: EditorDocument | undefined, local: EditorDocument | undefined) {
  if (!builtIn || !local) {
    if (builtIn !== local) changes.push({ group: `${orientation}布局`, field: "布局", builtInValue: builtIn ? "存在" : "无", localValue: local ? "存在" : "无" });
    return;
  }
  if (JSON.stringify(builtIn.distributions ?? []) !== JSON.stringify(local.distributions ?? [])) {
    changes.push({group:`${orientation} · 排版`,field:"等间距规则",builtInValue:`${builtIn.distributions?.length ?? 0} 组`,localValue:`${local.distributions?.length ?? 0} 组（已修改）`});
  }
  for (const [key, label] of frameFields) compareField(changes, `${orientation} · 相框`, key, label, builtIn.frame[key], local.frame[key]);
  for (const region of ["top", "bottom", "left", "right"] as const) {
    for (const [key, label] of regionFields) {
      compareField(changes, `${orientation} · ${regionNames[region]}`, key, label, builtIn.regions[region][key], local.regions[region][key]);
    }
  }

  const originalLayers = new Map(builtIn.layers.map((layer) => [layer.id, layer]));
  const localLayers = new Map(local.layers.map((layer) => [layer.id, layer]));
  for (const layer of builtIn.layers) {
    const changed = localLayers.get(layer.id);
    if (!changed) {
      changes.push({ group: `${orientation} · 水印图层`, field: `「${layer.name}」`, builtInValue: "存在", localValue: "已删除" });
      continue;
    }
    for (const [key, label] of layerFields) {
      compareField(changes, `${orientation} · 水印「${layer.name}」`, key, label, layer[key], changed[key]);
    }
  }
  for (const layer of local.layers) {
    if (!originalLayers.has(layer.id)) changes.push({ group: `${orientation} · 水印图层`, field: `「${layer.name}」`, builtInValue: "无", localValue: "已添加" });
  }
  const originalOrder = builtIn.layers.filter((layer) => localLayers.has(layer.id)).map((layer) => layer.id);
  const localOrder = local.layers.filter((layer) => originalLayers.has(layer.id)).map((layer) => layer.id);
  if (originalOrder.join("\u0000") !== localOrder.join("\u0000")) {
    const names = (ids: string[]) => ids.map((id) => localLayers.get(id)?.name ?? originalLayers.get(id)?.name ?? id).join(" → ");
    changes.push({ group: `${orientation} · 水印图层`, field: "图层顺序", builtInValue: names(originalOrder), localValue: names(localOrder) });
  }
}

export function diffTemplates(builtIn: TemplateRecord, local: TemplateRecord): TemplateChange[] {
  const changes: TemplateChange[] = [];
  compareField(changes, "基本信息", "name", "模板名称", builtIn.name, local.name);
  compareField(changes, "基本信息", "description", "模板说明", builtIn.description, local.description);
  compareField(changes, "基本信息", "cover", "预览封面", builtIn.cover, local.cover);
  compareDocument(changes, "横图", builtIn.layouts.landscape, local.layouts.landscape);
  compareDocument(changes, "竖图", builtIn.layouts.portrait, local.layouts.portrait);
  return changes;
}
