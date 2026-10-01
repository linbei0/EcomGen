/**
 * 规格包品类示意图：高级扁平插画风场景渲染（SVG 渐变塑形 + 花型贴图 + 光影叠加）。
 *
 * 与摄影级 mockup 的边界：无实拍素材，用渐变/接触阴影/光泽层表达「图案印在产品上」的
 * 体积与光照关系，不伪造照片质感；UI 侧以「示意图」标注。刻意不用 SVG 滤镜（feGaussianBlur
 * 在各平台 librsvg 构建下支持不一），所有软阴影用径向渐变的 alpha 衰减实现，保证跨平台确定性。
 *
 * 分层：base（背景/接触阴影/产品平底色）→ 花型贴印刷区 → overlay（统一光影 clipped 到产品
 * 轮廓、结构细节、光泽）。花型必须参与产品光照——overlay 的明暗渐变盖在贴图之上，这是
 * 「印上去」而不是「贴上去」的关键。印刷区纵横比锁定为规格纵横比（马克杯例外：直视杯面
 * 只呈现围边的中央可见带，由 placement 的 cover-裁切自然取中）。
 */

import sharp from "sharp";
import type { PodPrintCategory } from "@ecomgen/contracts";

export interface MockupGeometry {
  width: number;
  height: number;
  printArea: { x: number; y: number; width: number; height: number };
}

/** 示意图画布边长；产品占画面 55%-70%，留出场景呼吸空间。 */
export const MOCKUP_CANVAS = 1200;

/** 马克杯直视面呈现的围边中央比例：band 纵横比 = 围边纵横比 × 该比例（测试锁定）。 */
export const MUG_VISIBLE_WRAP_FRACTION = 0.42;

const CANVAS = MOCKUP_CANVAS;

const GEOMETRIES: Record<PodPrintCategory, MockupGeometry> = {
  // 非马克杯：印刷区纵横比 === 规格纵横比（T恤/卫衣 12×16、海报 18×24、帆布袋 15×15、手机壳 900×1650）。
  TSHIRT: { width: CANVAS, height: CANVAS, printArea: { x: 450, y: 380, width: 300, height: 400 } },
  // 卫衣印刷区下移到帽口（胸前帽兜开口底 ~424）之下，避免贴图被帽口与抽绳压住。
  HOODIE: { width: CANVAS, height: CANVAS, printArea: { x: 450, y: 452, width: 300, height: 400 } },
  // 马克杯：357×370 可见带 ≈ 2550×1110 围边的中央 42%（357/850），纵横比 0.965。
  MUG_11OZ: { width: CANVAS, height: CANVAS, printArea: { x: 421, y: 455, width: 357, height: 370 } },
  POSTER: { width: CANVAS, height: CANVAS, printArea: { x: 390, y: 230, width: 420, height: 560 } },
  TOTE_BAG: { width: CANVAS, height: CANVAS, printArea: { x: 435, y: 470, width: 330, height: 330 } },
  PHONE_CASE: { width: CANVAS, height: CANVAS, printArea: { x: 409, y: 285, width: 382, height: 700 } },
};
export function mockupGeometryFor(category: PodPrintCategory): MockupGeometry {
  return GEOMETRIES[category];
}

export interface MockupArtworkPlacement {
  resizeWidth: number;
  resizeHeight: number;
  extract: { left: number; top: number; width: number; height: number };
}

/**
 * 印刷区取材参数：cover 缩放 + 居中裁切。规格纵横比与印刷区一致的品类等价于无裁切直出；
 * 马克杯可见带窄于围边纵横比，自然裁出中央可见段，花型比例保持物理真实。
 */
export function computeMockupArtworkPlacement(geometry: MockupGeometry, specWidthPx: number, specHeightPx: number): MockupArtworkPlacement {
  const area = geometry.printArea;
  const scale = Math.max(area.width / specWidthPx, area.height / specHeightPx);
  const resizeWidth = Math.max(area.width, Math.round(specWidthPx * scale));
  const resizeHeight = Math.max(area.height, Math.round(specHeightPx * scale));
  const left = Math.min(Math.round((resizeWidth - area.width) / 2), resizeWidth - area.width);
  const top = Math.min(Math.round((resizeHeight - area.height) / 2), resizeHeight - area.height);
  return { resizeWidth, resizeHeight, extract: { left, top, width: area.width, height: area.height } };
}

// ---- 共享渐变 ----
// 背景为暖灰摄影棚色系（浅色场景在暗色 UI 里以卡片+阴影呈现，产品读得最清楚）。
// 光影叠加层的 stop 全部用 rgba 半透明色，盖在花型上只改变明暗不改变色相。

const DEFS = `
<defs>
  <linearGradient id="gWall" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f2efe9"/><stop offset="1" stop-color="#ddd8d0"/>
  </linearGradient>
  <linearGradient id="gSurface" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#eee9e1"/><stop offset="1" stop-color="#d9d3c8"/>
  </linearGradient>
  <linearGradient id="gFloor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#d3cdc4"/><stop offset="1" stop-color="#c1bab0"/>
  </linearGradient>
  <radialGradient id="gVig" cx="0.5" cy="0.42" r="0.78">
    <stop offset="0" stop-color="rgba(52,47,40,0)"/><stop offset="0.62" stop-color="rgba(52,47,40,0)"/><stop offset="1" stop-color="rgba(52,47,40,0.16)"/>
  </radialGradient>
  <radialGradient id="gShadow">
    <stop offset="0" stop-color="rgba(44,39,32,0.32)"/><stop offset="0.55" stop-color="rgba(44,39,32,0.12)"/><stop offset="1" stop-color="rgba(44,39,32,0)"/>
  </radialGradient>
  <linearGradient id="gDrop" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="rgba(44,39,32,0.22)"/><stop offset="0.5" stop-color="rgba(44,39,32,0)"/>
  </linearGradient>
  <linearGradient id="gCeramic" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="rgba(96,86,72,0.28)"/><stop offset="0.14" stop-color="rgba(120,110,96,0.05)"/>
    <stop offset="0.34" stop-color="rgba(255,255,255,0.30)"/><stop offset="0.52" stop-color="rgba(255,255,255,0.06)"/>
    <stop offset="0.78" stop-color="rgba(96,86,72,0.10)"/><stop offset="1" stop-color="rgba(76,68,56,0.34)"/>
  </linearGradient>
  <linearGradient id="gTee" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#e7e0d1"/><stop offset="1" stop-color="#d4cdbb"/>
  </linearGradient>
  <linearGradient id="gHood" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#e4ddcd"/><stop offset="1" stop-color="#d0c9b6"/>
  </linearGradient>
  <linearGradient id="gFabricShade" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="rgba(96,86,72,0.14)"/><stop offset="0.2" stop-color="rgba(96,86,72,0)"/>
    <stop offset="0.8" stop-color="rgba(96,86,72,0)"/><stop offset="1" stop-color="rgba(96,86,72,0.16)"/>
  </linearGradient>
  <linearGradient id="gGloss" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="rgba(255,255,255,0.22)"/><stop offset="0.3" stop-color="rgba(255,255,255,0.05)"/>
    <stop offset="0.48" stop-color="rgba(255,255,255,0)"/><stop offset="1" stop-color="rgba(70,63,54,0.12)"/>
  </linearGradient>
  <linearGradient id="gHandle" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#efe9df"/><stop offset="0.5" stop-color="#ddd5c8"/><stop offset="1" stop-color="#a99f8e"/>
  </linearGradient>
  <linearGradient id="gFrame" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#4a453e"/><stop offset="0.5" stop-color="#28251f"/><stop offset="1" stop-color="#3a362f"/>
  </linearGradient>
  <linearGradient id="gCam" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#45423d"/><stop offset="1" stop-color="#1d1c1a"/>
  </linearGradient>
</defs>`;

const VIGNETTE = `<rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="url(#gVig)"/>`;

/** 摄影棚墙 + 地面（立式产品用）；horizon 为地面线 y 坐标。 */
function studioRoom(horizon: number): string {
  return `<rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="url(#gWall)"/>
    <rect x="0" y="${horizon}" width="${CANVAS}" height="${CANVAS - horizon}" fill="url(#gFloor)"/>`;
}

/** 平铺台面（俯视品类用）。 */
function flatSurface(): string {
  return `<rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="url(#gSurface)"/>`;
}

/** 接触阴影：径向渐变椭圆，落在产品底部让它「站」在场景里。 */
function contactShadow(cx: number, cy: number, rx: number, ry: number, opacity = 1): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#gShadow)" opacity="${opacity}"/>`;
}

const TEE_PATH = "M438 300 L348 336 L252 470 L340 545 L398 498 L398 940 Q600 972 802 940 L802 498 L860 545 L948 470 L852 336 L762 300 Q600 352 438 300 Z";
const HOODIE_PATH = "M428 306 L338 342 L242 476 L330 551 L388 504 L388 944 Q600 976 812 944 L812 504 L870 551 L958 476 L862 342 L772 306 Q600 372 428 306 Z";
const TOTE_PATH = "M356 398 L844 398 L862 916 Q600 936 338 916 Z";
const MUG_BODY = { x: 380, y: 400, w: 440, h: 480, rx: 34 };
const CASE_BODY = { x: 390, y: 250, w: 420, h: 770, rx: 64 };
const FRAME = { x: 330, y: 150, w: 540, h: 720 };

/** 底图：场景背景 + 产品平底色（无描边无光影——光影统一在 overlay）。 */
function mockupBaseSvg(category: PodPrintCategory): string {
  const mug = MUG_BODY;
  const bodies: Record<PodPrintCategory, string> = {
    TSHIRT: `${flatSurface()}
      ${contactShadow(600, 952, 365, 42, 0.7)}
      <path d="${TEE_PATH}" fill="url(#gTee)"/>
      <path d="M438 300 Q600 352 762 300 Q600 388 438 300 Z" fill="#cfc8b6"/>`,
    HOODIE: `${flatSurface()}
      ${contactShadow(600, 950, 370, 42, 0.7)}
      <path d="M470 318 Q476 184 600 170 Q724 184 730 318 Q600 356 470 318 Z" fill="#d9d3c4"/>
      <path d="${HOODIE_PATH}" fill="url(#gHood)"/>
      <path d="M505 302 Q600 294 695 302 Q702 400 600 424 Q498 400 505 302 Z" fill="#c7bfae"/>
      <path d="M532 310 Q600 304 668 310 Q672 378 600 398 Q528 378 532 310 Z" fill="#aea48f"/>`,
    MUG_11OZ: `${studioRoom(880)}
      ${contactShadow(618, 884, 290, 30)}
      <rect x="${mug.x}" y="${mug.y}" width="${mug.w}" height="${mug.h}" rx="${mug.rx}" fill="#ece7df"/>
      <ellipse cx="600" cy="400" rx="220" ry="30" fill="#e0dad0"/>
      <ellipse cx="600" cy="400" rx="200" ry="22" fill="#8d8577"/>`,
    POSTER: `<rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="url(#gWall)"/>
      <rect x="${FRAME.x + 22}" y="${FRAME.y + 24}" width="${FRAME.w + 36}" height="${FRAME.h + 40}" fill="url(#gDrop)"/>
      <rect x="${FRAME.x}" y="${FRAME.y}" width="${FRAME.w}" height="${FRAME.h}" rx="3" fill="url(#gFrame)"/>
      <rect x="${FRAME.x + 22}" y="${FRAME.y + 22}" width="${FRAME.w - 44}" height="${FRAME.h - 44}" fill="#fbfaf6"/>`,
    TOTE_BAG: `${studioRoom(916)}
      ${contactShadow(600, 920, 255, 26)}
      <path d="M462 396 L462 268 Q462 238 494 238 L706 238 Q738 238 738 268 L738 396" fill="none" stroke="#c8c0af" stroke-width="18" stroke-linecap="round"/>
      <path d="${TOTE_PATH}" fill="#e8e2d5"/>`,
    PHONE_CASE: `${flatSurface()}
      ${contactShadow(614, 1002, 245, 30, 0.9)}
      <rect x="${CASE_BODY.x}" y="${CASE_BODY.y}" width="${CASE_BODY.w}" height="${CASE_BODY.h}" rx="${CASE_BODY.rx}" fill="#f0ece5"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">${DEFS}${bodies[category]}</svg>`;
}

/** 叠加层：盖在花型之上的统一光影（clipped 到产品轮廓）、结构细节与光泽。 */
function mockupOverlaySvg(category: PodPrintCategory): string {
  const mug = MUG_BODY;
  const caseB = CASE_BODY;
  const frame = FRAME;
  const details: Record<PodPrintCategory, string> = {
    TSHIRT: `<clipPath id="teeClip"><path d="${TEE_PATH}"/></clipPath>
      <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="url(#gFabricShade)" clip-path="url(#teeClip)"/>
      <path d="M438 300 L348 336 L252 470 L340 545 L398 498 Z" fill="rgba(96,86,70,0.09)"/>
      <path d="M762 300 L852 336 L948 470 L860 545 L802 498 Z" fill="rgba(96,86,70,0.09)"/>
      <path d="M438 300 Q404 396 398 498 M762 300 Q796 396 802 498" stroke="rgba(96,86,70,0.16)" stroke-width="2.5" fill="none"/>
      <path d="M420 566 Q600 606 780 566" stroke="rgba(110,100,88,0.08)" stroke-width="24" fill="none" stroke-linecap="round" clip-path="url(#teeClip)"/>
      <path d="M430 736 Q600 772 770 736" stroke="rgba(110,100,88,0.07)" stroke-width="22" fill="none" stroke-linecap="round" clip-path="url(#teeClip)"/>
      <path d="M438 300 Q600 352 762 300" fill="none" stroke="rgba(80,72,60,0.26)" stroke-width="2.5"/>
      <path d="M402 942 Q600 970 798 942" stroke="rgba(90,82,70,0.15)" stroke-width="2.5" fill="none" stroke-dasharray="9 7"/>`,
    HOODIE: `<clipPath id="hoodieClip"><path d="${HOODIE_PATH}"/></clipPath>
      <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="url(#gFabricShade)" clip-path="url(#hoodieClip)"/>
      <path d="M428 306 L338 342 L242 476 L330 551 L388 504 Z" fill="rgba(96,86,70,0.09)"/>
      <path d="M772 306 L862 342 L958 476 L870 551 L812 504 Z" fill="rgba(96,86,70,0.09)"/>
      <path d="M428 306 Q396 404 388 504 M772 306 Q804 404 812 504" stroke="rgba(96,86,70,0.16)" stroke-width="2.5" fill="none"/>
      <path d="M505 302 Q600 294 695 302 Q702 400 600 424 Q498 400 505 302 Z" fill="none" stroke="rgba(80,72,60,0.28)" stroke-width="3"/>
      <path d="M558 344 Q553 392 551 434 M642 344 Q647 392 649 434" stroke="#cfc8b9" stroke-width="7" stroke-linecap="round" fill="none"/>
      <circle cx="551" cy="440" r="5" fill="#b3aa99"/><circle cx="649" cy="440" r="5" fill="#b3aa99"/>
      <rect x="428" y="864" width="344" height="78" rx="16" fill="none" stroke="rgba(90,82,70,0.16)" stroke-width="3"/>`,
    MUG_11OZ: `<clipPath id="mugClip"><rect x="${mug.x}" y="${mug.y}" width="${mug.w}" height="${mug.h}" rx="${mug.rx}"/></clipPath>
      <circle cx="852" cy="630" r="96" fill="none" stroke="rgba(70,62,52,0.22)" stroke-width="40"/>
      <circle cx="852" cy="630" r="96" fill="none" stroke="url(#gHandle)" stroke-width="34"/>
      <rect x="${mug.x}" y="${mug.y}" width="${mug.w}" height="${mug.h}" rx="${mug.rx}" fill="url(#gCeramic)" clip-path="url(#mugClip)"/>
      <ellipse cx="600" cy="400" rx="220" ry="30" fill="none" stroke="rgba(70,62,52,0.20)" stroke-width="2"/>
      <path d="M${mug.x + 3} ${mug.y + mug.h - 8} Q600 ${mug.y + mug.h + 16} ${mug.x + mug.w - 3} ${mug.y + mug.h - 8}" stroke="rgba(70,62,52,0.18)" stroke-width="2" fill="none"/>`,
    POSTER: `<clipPath id="frameClip"><rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" rx="3"/></clipPath>
      <rect x="${frame.x + 22}" y="${frame.y + 22}" width="${frame.w - 44}" height="${frame.h - 44}" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="2"/>
      <rect x="390" y="230" width="420" height="560" fill="none" stroke="rgba(35,30,24,0.20)" stroke-width="1.5"/>
      <path d="M${frame.x} ${frame.y} L${frame.x + 250} ${frame.y} L${frame.x} ${frame.y + 380} Z" fill="rgba(255,255,255,0.08)" clip-path="url(#frameClip)"/>`,
    TOTE_BAG: `<clipPath id="toteClip"><path d="${TOTE_PATH}"/></clipPath>
      <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="url(#gFabricShade)" clip-path="url(#toteClip)"/>
      <path d="M356 398 L844 398" stroke="rgba(80,72,60,0.18)" stroke-width="2"/>
      <path d="M462 396 L462 268 Q462 238 494 238 L706 238 Q738 238 738 268 L738 396" fill="none" stroke="rgba(70,62,52,0.16)" stroke-width="20" stroke-linecap="round"/>
      <path d="M462 396 L462 268 Q462 238 494 238 L706 238 Q738 238 738 268 L738 396" fill="none" stroke="#d8d0c0" stroke-width="16" stroke-linecap="round"/>`,
    PHONE_CASE: `<clipPath id="caseClip"><rect x="${caseB.x}" y="${caseB.y}" width="${caseB.w}" height="${caseB.h}" rx="${caseB.rx}"/></clipPath>
      <rect x="${caseB.x}" y="${caseB.y}" width="${caseB.w}" height="${caseB.h}" rx="${caseB.rx}" fill="url(#gGloss)" clip-path="url(#caseClip)"/>
      <rect x="${caseB.x + 1.5}" y="${caseB.y + 1.5}" width="${caseB.w - 3}" height="${caseB.h - 3}" rx="${caseB.rx - 1.5}" fill="none" stroke="rgba(70,62,52,0.22)" stroke-width="2.5"/>
      <rect x="${caseB.x + 38}" y="${caseB.y + 36}" width="150" height="150" rx="38" fill="url(#gCam)"/>
      <circle cx="${caseB.x + 80}" cy="${caseB.y + 78}" r="26" fill="#121110"/><circle cx="${caseB.x + 80}" cy="${caseB.y + 78}" r="26" fill="none" stroke="#4c4944" stroke-width="3"/><circle cx="${caseB.x + 74}" cy="${caseB.y + 72}" r="8" fill="rgba(160,155,145,0.75)"/>
      <circle cx="${caseB.x + 146}" cy="${caseB.y + 144}" r="26" fill="#121110"/><circle cx="${caseB.x + 146}" cy="${caseB.y + 144}" r="26" fill="none" stroke="#4c4944" stroke-width="3"/><circle cx="${caseB.x + 140}" cy="${caseB.y + 138}" r="8" fill="rgba(160,155,145,0.75)"/>
      <circle cx="${caseB.x + 146}" cy="${caseB.y + 78}" r="9" fill="#d8d2c6"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">${DEFS}${details[category]}</svg>`;
}

/** 合成品类示意图：底图 → 花型 cover-裁切贴印刷区 → 光影/结构叠加层。输出 ${CANVAS}×${CANVAS} PNG。 */
export async function renderPrintMockup(category: PodPrintCategory, printFilePng: Buffer): Promise<Buffer> {
  const geometry = mockupGeometryFor(category);
  const meta = await sharp(printFilePng).metadata();
  if (!meta.width || !meta.height) throw new Error("Print file dimensions are unavailable for mockup rendering");
  const placement = computeMockupArtworkPlacement(geometry, meta.width, meta.height);
  const artwork = await sharp(printFilePng)
    .resize(placement.resizeWidth, placement.resizeHeight, { fit: "fill", kernel: "lanczos3" })
    .extract(placement.extract)
    .png()
    .toBuffer();
  const base = await sharp(Buffer.from(mockupBaseSvg(category))).png().toBuffer();
  const overlay = Buffer.from(mockupOverlaySvg(category));
  return sharp(base)
    .composite([
      { input: artwork, left: geometry.printArea.x, top: geometry.printArea.y },
      { input: overlay },
    ])
    .png()
    .toBuffer();
}
