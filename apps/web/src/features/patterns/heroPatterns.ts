/**
 * Hero Patterns 装饰底纹：图案来自 heropatterns.com（Steve Schoger，CC BY 4.0），
 * 经 hero-patterns npm 包（lowmess 维护，MIT）提供，返回可直接用于 CSS
 * backgroundImage 的 url('data:image/svg+xml,...') 字符串。
 *
 * data-URI 是独立文档，CSS 变量不会在其中解析：颜色常量必须与 src/design/tokens.css
 * 手工保持一致（--accent #d9a441 / --text-1 #edece6）。透明度压在 0.04-0.06：
 * 装饰只提供质感，不与内容争夺注意力。
 *
 * topography 的 data-URI 约 110KB：仅在模块加载时计算一次，多处共享同一字符串引用。
 */
import { signal, topography } from "hero-patterns";

const ACCENT = "#d9a441";
const TEXT = "#edece6";

/** 空状态面板与抽屉空位共用的地形纹理。 */
export const panelBackdrop = topography(ACCENT, 0.05);
/** 生成占位卡的信号纹理（1KB，适合多个卡同时挂载）。 */
export const placeholderBackdrop = signal(TEXT, 0.05);
