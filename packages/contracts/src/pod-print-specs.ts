import type { PodPrintSpec } from "./pod-schemas.js";

/**
 * 印刷规格目录（v1，CENTERED 居中版式）。
 *
 * 数据来源为 Printful / Printify 公开模板尺寸（调研见 docs/reference/pod-domain-research.md 2.2），
 * 像素 = 英寸 × 300DPI。平台与工厂的模板会不定期修订：specVersion 进入每个规格包 manifest，
 * 修订目录时递增版本号；逐单生产前仍以目标工厂模板为准（notes 已随条目下发到前端）。
 *
 * 该文件是纯数据常量，不进 API_SCHEMA_REGISTRY；对外暴露走 GET /pod/print-specs。
 */

export const POD_PRINT_SPEC_VERSION = "2026.09";

/**
 * 内置 mockup 场景渲染版本：场景画风（几何/配色/光影配方）修订时递增。
 * 与 specVersion 分开演进——规格目录未变而场景重绘时，api 侧用它判定旧规格包
 * 的示意图已过期（manifest.mockupScene 不等于当前版本即不复用），重新成包得到新渲染。
 */
export const POD_MOCKUP_SCENE_VERSION = "2026.09.1";

export const POD_PRINT_SPECS: readonly PodPrintSpec[] = [
  {
    id: "tshirt-front-12x16",
    category: "TSHIRT",
    label: "T恤前片（12×16 英寸）",
    widthPx: 3600,
    heightPx: 4800,
    dpi: 300,
    safeMarginPct: 6,
    notes: "来源：Printful/Printify 标准 DTG 前片可印区 12×16in@300DPI。加大款为 15×18in，本目录暂不区分尺码；投产前以工厂模板为准。",
  },
  {
    id: "hoodie-front-12x16",
    category: "HOODIE",
    label: "卫衣前片（12×16 英寸）",
    widthPx: 3600,
    heightPx: 4800,
    dpi: 300,
    safeMarginPct: 6,
    notes: "来源：Printful 卫衣标准前片可印区 12×16in@300DPI；连帽款口袋上方区域另有 14×12in 变体，暂不区分；投产前以工厂模板为准。",
  },
  {
    id: "mug-11oz-wrap",
    category: "MUG_11OZ",
    label: "11oz 马克杯环面",
    widthPx: 2550,
    heightPx: 1110,
    dpi: 300,
    safeMarginPct: 2,
    notes: "来源：Printful 11oz 马克杯环面约 8.5×3.7in@300DPI。v1 为居中版式，不做满环绕连续图案（需平铺能力，见方案 P1）；投产前以工厂模板为准。",
  },
  {
    id: "poster-18x24",
    category: "POSTER",
    label: "海报（18×24 英寸）",
    widthPx: 5400,
    heightPx: 7200,
    dpi: 300,
    safeMarginPct: 6,
    notes: "来源：Printful 18×24in@300DPI 全幅海报；其他海报尺寸按比例另立条目；投产前以工厂模板为准。",
  },
  {
    id: "tote-15x15",
    category: "TOTE_BAG",
    label: "帆布袋（15×15 英寸）",
    widthPx: 4500,
    heightPx: 4500,
    dpi: 300,
    safeMarginPct: 6,
    notes: "来源：Printful 全印帆布袋约 15×15in@300DPI。v1 为居中版式；真正的无边满印需可平铺花型（P1）；投产前以工厂模板为准。",
  },
  {
    id: "phonecase-generic",
    category: "PHONE_CASE",
    label: "手机壳（通用近似）",
    widthPx: 900,
    heightPx: 1650,
    dpi: 300,
    safeMarginPct: 4,
    notes: "通用近似值（约 3×5.5in@300DPI）。手机壳可印区逐机型不同，量产前必须按目标机型工厂模板核对；本条目仅用于效果图与初稿。",
  },
];

const specIndex = new Map(POD_PRINT_SPECS.map((spec) => [spec.id, spec]));

/** 按目录 ID 取规格；未知 specId 由 API 校验层拒绝，worker 内再次防御。 */
export function getPodPrintSpec(specId: string): PodPrintSpec | undefined {
  return specIndex.get(specId);
}
