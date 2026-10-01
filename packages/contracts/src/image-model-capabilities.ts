/**
 * 生图模型的按 ID 能力判定（纯数据 + 纯函数，不进 API_SCHEMA_REGISTRY）。
 *
 * 为什么放在 contracts：api 用它拒绝"选了不支持透明底的模型却要透明底"的请求，worker 用它决定
 * 要不要发 background 参数，web 用它告诉用户"这个模型出的是透明底"。三处必须是同一份判定——
 * 各写一份正则，迟早出现"界面标着透明底、实际请求发的是 opaque"这种自相矛盾的组合。
 *
 * 为什么按 ID 匹配而不是让用户在 Provider 表单里勾：表单里只有推理模型有能力开关
 * （视觉/思考/工具/结构化），生图模型的能力一直随模型家族走——同 input_fidelity 的判定。
 * 代价是模型目录修订时要来改这里，所以判定只回答"能不能要"；拿到手的是不是真的透明，
 * 由 worker 解码后校验 alpha 决定（见 apps/worker 的 pattern-background.ts）。
 * 要了不等于拿到了，这一层不许替 Provider 背书。
 */

/**
 * 支持"参数级"透明底的模型家族——即 API 有专门的字段表达透明，而不是只能靠提示词求模型。
 *
 * | 家族 | 机制 |
 * | --- | --- |
 * | GPT Image（下表） | `background: "transparent"` + `output_format` 取 png/webp |
 * | qwen-image-2.1 | 同名字段 `background`（hosted 路由）；开源权重侧是提示词驱动 |
 * | Recraft | `/images/removeBackground` 独立端点，或原生 SVG |
 * | Ideogram 3 | `/ideogram-v3/generate-transparent` 独立端点 |
 *
 * 本仓库只接 OpenAI-compatible 的 images 接口，所以这里只登记走 `background` 字段的家族。
 * 曾被考虑的排除项（改这里之前先看这段，别凭文档推断）：
 * - Gemini / Nano Banana 全系：输出没有 alpha 通道，提示词写 transparent 只会得到一块画出来的
 *   棋盘格或纯色底；要真透明得渲染白底与黑底两版再做差分抠像，属于另一条链路。
 * - seedream 4.0/4.5：输出只给 jpeg，装不下 alpha；seedream 5.0 只有提示词驱动，不保证。
 * - qwen-image-3.0 / mai-image-2.5：实测返回无 alpha 的 PNG，且接受非法字段不报错（字段被路由丢弃）。
 * - `gpt-image-2-all` / `gpt-image-2-vip` 这类网关变体：没有该字段，发了会被静默忽略。
 */
const TRANSPARENT_BACKGROUND_FAMILIES = ["gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5"] as const;

/**
 * 名字落在上面某个家族里、实际却没有 `background` 字段的网关别名。
 *
 * 这类 ID 是第三方转发档位（`gpt-image-2-all` / `-vip`）：请求带上的字段会被**静默忽略**而不是报错，
 * 于是一次付费调用换回一张不透明图。它们靠前缀无法与真家族区分，只能按名字列出。
 * 已知别名有限，出现新的再加一条——不要改成"凡是 -all/-vip 后缀一律拒绝"这类模式匹配：
 * 官方随时可能发布同名后缀的真模型，猜错方向会直接砍掉一项可用能力。
 */
const TRANSPARENT_BACKGROUND_ALIAS_EXCLUSIONS = new Set(["gpt-image-2-all", "gpt-image-2-vip"]);

/**
 * 模型是否支持请求透明底输出。
 *
 * 前缀匹配保留家族内的快照与变体（`gpt-image-1.5-2025-12-16`、`gpt-image-2.5-flare`），
 * 但要求家族名之后紧跟 `-` 或 `.` 或结束，避免 `gpt-image-1` 误吞别的模型名。
 *
 * gpt-image-2 曾因 SDK 类型注释与官方指南口径冲突被排除；2026-08-20 起官方 changelog 与
 * Cookbook 都以 `background: "transparent"` 为例（预览），据此改为纳入。第三方网关若未开这个
 * 权限，会返回明确的 400 "Transparent background is not supported for this model" 且发生在出图前，
 * 既不静默降级也不产生费用——把它当正常失败路径处理，不要在这里按网关二次过滤。
 */
export function supportsTransparentBackground(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (TRANSPARENT_BACKGROUND_ALIAS_EXCLUSIONS.has(id)) return false;
  return TRANSPARENT_BACKGROUND_FAMILIES.some(
    (family) => id === family || id.startsWith(`${family}-`) || id.startsWith(`${family}.`),
  );
}
