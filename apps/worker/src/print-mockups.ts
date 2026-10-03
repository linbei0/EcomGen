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

// 场景保持克制，让花型成为视觉中心；定向光影区分不同材质。
const SCENE_DEFS = `
<defs>
  <linearGradient id="wall" x2="0" y2="1"><stop stop-color="#f4f6f3"/><stop offset="1" stop-color="#e2e9e5"/></linearGradient>
  <linearGradient id="surface" x2="0" y2="1"><stop stop-color="#edf1ee"/><stop offset="1" stop-color="#d5ded9"/></linearGradient>
  <linearGradient id="floor" x2="0" y2="1"><stop stop-color="#ccd7d2"/><stop offset="1" stop-color="#bbc9c3"/></linearGradient>
  <radialGradient id="light" cx=".5" cy=".18" r=".82"><stop stop-color="#fff" stop-opacity=".72"/><stop offset=".65" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <radialGradient id="shadow"><stop stop-color="#273b35" stop-opacity=".3"/><stop offset=".55" stop-color="#273b35" stop-opacity=".1"/><stop offset="1" stop-color="#273b35" stop-opacity="0"/></radialGradient>
  <linearGradient id="cotton" x2="1" y2=".25"><stop stop-color="#d7d8d1"/><stop offset=".3" stop-color="#f4f3ed"/><stop offset=".72" stop-color="#ebe9e1"/><stop offset="1" stop-color="#d0d2cb"/></linearGradient>
  <linearGradient id="fleece" x2="1" y2=".18"><stop stop-color="#c9d5d1"/><stop offset=".32" stop-color="#e5ece8"/><stop offset=".72" stop-color="#dce5e1"/><stop offset="1" stop-color="#bac9c3"/></linearGradient>
  <linearGradient id="canvas" x2="1" y2="1"><stop stop-color="#f0e7d7"/><stop offset=".48" stop-color="#e5dac7"/><stop offset="1" stop-color="#cfc1ab"/></linearGradient>
  <linearGradient id="ceramic" x2="1"><stop stop-color="#b8c3bf" stop-opacity=".52"/><stop offset=".18" stop-color="#fff" stop-opacity=".12"/><stop offset=".36" stop-color="#fff" stop-opacity=".55"/><stop offset=".7" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#82918b" stop-opacity=".42"/></linearGradient>
  <linearGradient id="handle" x2="0" y2="1"><stop stop-color="#fdfcf8"/><stop offset=".55" stop-color="#e4e5df"/><stop offset="1" stop-color="#aebbb5"/></linearGradient>
  <linearGradient id="frame" x2="1"><stop stop-color="#3b4944"/><stop offset=".5" stop-color="#202d29"/><stop offset="1" stop-color="#4b5852"/></linearGradient>
  <linearGradient id="glass" x2="0" y2="1"><stop stop-color="#414c49"/><stop offset="1" stop-color="#171e1c"/></linearGradient>
  <linearGradient id="fabricLight" x2="1"><stop stop-color="#344b43" stop-opacity=".2"/><stop offset=".22" stop-color="#fff" stop-opacity=".02"/><stop offset=".5" stop-color="#fff" stop-opacity=".16"/><stop offset=".78" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#344b43" stop-opacity=".16"/></linearGradient>
</defs>`;

function scene(horizon?: number): string {
  const backdrop = horizon === undefined
    ? `<rect width="${CANVAS}" height="${CANVAS}" fill="url(#surface)"/>`
    : `<rect width="${CANVAS}" height="${CANVAS}" fill="url(#wall)"/><rect y="${horizon}" width="${CANVAS}" height="${CANVAS - horizon}" fill="url(#floor)"/>`;
  return `${backdrop}<rect width="${CANVAS}" height="${CANVAS}" fill="url(#light)"/>`;
}

function shadow(cx: number, cy: number, rx: number, ry: number): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#shadow)"/>`;
}

const TEE_PATH = "M438 300 L348 336 L252 470 L340 545 L398 498 L398 940 Q600 970 802 940 L802 498 L860 545 L948 470 L852 336 L762 300 Q600 350 438 300 Z";
const HOODIE_PATH = "M428 306 L338 342 L242 476 L330 551 L388 504 L388 944 Q600 976 812 944 L812 504 L870 551 L958 476 L862 342 L772 306 Q600 372 428 306 Z";
const TOTE_PATH = "M356 398 L844 398 L862 916 Q600 936 338 916 Z";
const MUG_BODY = { x: 350, y: 372, w: 500, h: 520, rx: 42 };
const CASE_BODY = { x: 390, y: 250, w: 420, h: 770, rx: 64 };
const FRAME = { x: 330, y: 150, w: 540, h: 720 };

function mockupBaseSvg(category: PodPrintCategory): string {
  const mug = MUG_BODY;
  const bodies: Record<PodPrintCategory, string> = {
    TSHIRT: `${scene()}${shadow(600, 960, 370, 52)}
      <path d="${TEE_PATH}" fill="url(#cotton)"/>
      <path d="M438 300 Q600 351 762 300 Q600 380 438 300Z" fill="#d5d7d0"/>
      <path d="M438 300 Q600 351 762 300 Q600 361 438 300Z" fill="#fff" opacity=".42"/>`,
    HOODIE: `${scene()}${shadow(600, 958, 374, 52)}
      <path d="M470 318 Q476 184 600 170 Q724 184 730 318 Q600 356 470 318Z" fill="#c3d0cb"/>
      <path d="${HOODIE_PATH}" fill="url(#fleece)"/>
      <path d="M505 302 Q600 294 695 302 Q702 400 600 424 Q498 400 505 302Z" fill="#c4d0cc"/>
      <path d="M532 310 Q600 304 668 310 Q672 378 600 398 Q528 378 532 310Z" fill="#a7b7b1"/>
      <path d="M470 318 Q476 184 600 170 Q724 184 730 318 Q600 350 470 318Z" fill="#fff" opacity=".18"/>`,
    MUG_11OZ: `${scene(890)}${shadow(620, 898, 325, 42)}
      <ellipse cx="858" cy="632" rx="122" ry="130" fill="none" stroke="#9ba9a3" stroke-width="34"/>
      <ellipse cx="858" cy="632" rx="122" ry="130" fill="none" stroke="url(#handle)" stroke-width="27"/>
      <rect x="${mug.x}" y="${mug.y}" width="${mug.w}" height="${mug.h}" rx="${mug.rx}" fill="#f0f1ec"/>
      <ellipse cx="600" cy="372" rx="250" ry="38" fill="#f8f9f5"/>
      <ellipse cx="600" cy="372" rx="224" ry="26" fill="#66736e"/>
      <ellipse cx="600" cy="372" rx="208" ry="19" fill="#414d48" opacity=".62"/>`,
    POSTER: `${scene(940)}${shadow(624, 875, 310, 76)}
      <rect x="${FRAME.x}" y="${FRAME.y}" width="${FRAME.w}" height="${FRAME.h}" rx="5" fill="url(#frame)"/>
      <rect x="352" y="172" width="496" height="676" fill="#f7f7f2"/>
      <rect x="374" y="194" width="452" height="632" fill="#fff"/>`,
    TOTE_BAG: `${scene(916)}${shadow(600, 922, 270, 30)}
      <path d="M462 402 L462 268 Q462 236 494 236 L706 236 Q738 236 738 268 L738 402" fill="none" stroke="#aa9d89" stroke-width="25" stroke-linecap="round"/>
      <path d="M462 402 L462 268 Q462 236 494 236 L706 236 Q738 236 738 268 L738 402" fill="none" stroke="url(#canvas)" stroke-width="18" stroke-linecap="round"/>
      <path d="${TOTE_PATH}" fill="url(#canvas)"/>`,
    PHONE_CASE: `${scene()}${shadow(614, 1004, 250, 34)}
      <rect x="${CASE_BODY.x}" y="${CASE_BODY.y}" width="${CASE_BODY.w}" height="${CASE_BODY.h}" rx="${CASE_BODY.rx}" fill="#f8f8f4"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">${SCENE_DEFS}${bodies[category]}</svg>`;
}

function mockupOverlaySvg(category: PodPrintCategory): string {
  const mug = MUG_BODY;
  const caseB = CASE_BODY;
  const frame = FRAME;
  const details: Record<PodPrintCategory, string> = {
    TSHIRT: `<clipPath id="tee"><path d="${TEE_PATH}"/></clipPath>
      <rect width="${CANVAS}" height="${CANVAS}" fill="url(#fabricLight)" clip-path="url(#tee)"/>
      <path d="M438 300 L348 336 L252 470 L340 545 L398 498 M762 300 L852 336 L948 470 L860 545 L802 498" fill="none" stroke="#738078" stroke-opacity=".3" stroke-width="3"/>
      <path d="M438 300 Q405 402 398 498 M762 300 Q795 402 802 498" fill="none" stroke="#68766e" stroke-opacity=".28" stroke-width="3"/>
      <path d="M438 300 Q600 351 762 300" fill="none" stroke="#65746c" stroke-opacity=".42" stroke-width="3"/>
      <path d="M402 942 Q600 970 798 942" fill="none" stroke="#65746c" stroke-opacity=".32" stroke-width="3" stroke-dasharray="5 7"/>
      <path d="M500 316 Q600 342 700 316 Q688 356 600 364 Q512 356 500 316Z" fill="none" stroke="#718078" stroke-opacity=".42" stroke-width="3"/>`,
    HOODIE: `<clipPath id="hood"><path d="${HOODIE_PATH}"/></clipPath>
      <rect width="${CANVAS}" height="${CANVAS}" fill="url(#fabricLight)" clip-path="url(#hood)"/>
      <path d="M428 306 L338 342 L242 476 L330 551 L388 504 M772 306 L862 342 L958 476 L870 551 L812 504" fill="none" stroke="#657970" stroke-opacity=".34" stroke-width="3"/>
      <path d="M428 306 Q396 404 388 504 M772 306 Q804 404 812 504" fill="none" stroke="#657970" stroke-opacity=".32" stroke-width="3"/>
      <path d="M505 302 Q600 294 695 302 Q702 400 600 424 Q498 400 505 302Z" fill="none" stroke="#596e65" stroke-opacity=".48" stroke-width="3"/>
      <path d="M558 344 Q553 392 551 434 M642 344 Q647 392 649 434" fill="none" stroke="#edf2ef" stroke-opacity=".9" stroke-width="7" stroke-linecap="round"/>
      <circle cx="551" cy="440" r="5" fill="#8fa098"/><circle cx="649" cy="440" r="5" fill="#8fa098"/>
      <path d="M428 856 Q600 836 772 856 L772 920 Q600 946 428 920Z" fill="#c4d0cb" fill-opacity=".62" stroke="#718078" stroke-opacity=".32" stroke-width="3"/>`,
    MUG_11OZ: `<clipPath id="mug"><rect x="${mug.x}" y="${mug.y}" width="${mug.w}" height="${mug.h}" rx="${mug.rx}"/></clipPath>
      <rect x="${mug.x}" y="${mug.y}" width="${mug.w}" height="${mug.h}" rx="${mug.rx}" fill="url(#ceramic)" clip-path="url(#mug)"/>
      <ellipse cx="600" cy="372" rx="250" ry="38" fill="none" stroke="#788781" stroke-opacity=".3" stroke-width="3"/>
      <ellipse cx="600" cy="374" rx="211" ry="20" fill="none" stroke="#fff" stroke-opacity=".46" stroke-width="3"/>
      <path d="M355 878 Q600 900 845 878" fill="none" stroke="#7c8a84" stroke-opacity=".3" stroke-width="3"/>`,
    POSTER: `<clipPath id="poster"><rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" rx="5"/></clipPath>
      <rect x="352" y="172" width="496" height="676" fill="none" stroke="#283731" stroke-opacity=".36" stroke-width="3"/>
      <path d="M330 150 L610 150 L330 510Z" fill="#fff" fill-opacity=".1" clip-path="url(#poster)"/>
      <path d="M338 158 H862" fill="none" stroke="#fff" stroke-opacity=".36" stroke-width="4"/>`,
    TOTE_BAG: `<clipPath id="tote"><path d="${TOTE_PATH}"/></clipPath>
      <rect width="${CANVAS}" height="${CANVAS}" fill="url(#fabricLight)" clip-path="url(#tote)"/>
      <path d="M356 398 Q600 418 844 398" fill="none" stroke="#8e806a" stroke-opacity=".48" stroke-width="3"/>
      <path d="M382 450 Q600 478 818 450 M364 874 Q600 896 836 874" fill="none" stroke="#8b7d67" stroke-opacity=".22" stroke-width="3" stroke-dasharray="6 6" clip-path="url(#tote)"/>`,
    PHONE_CASE: `<clipPath id="case"><rect x="${caseB.x}" y="${caseB.y}" width="${caseB.w}" height="${caseB.h}" rx="${caseB.rx}"/></clipPath>
      <rect x="${caseB.x}" y="${caseB.y}" width="${caseB.w}" height="${caseB.h}" rx="${caseB.rx}" fill="url(#ceramic)" opacity=".42" clip-path="url(#case)"/>
      <rect x="${caseB.x + 2}" y="${caseB.y + 2}" width="${caseB.w - 4}" height="${caseB.h - 4}" rx="${caseB.rx - 2}" fill="none" stroke="#77827d" stroke-opacity=".4" stroke-width="4"/>
      <rect x="${caseB.x + 34}" y="${caseB.y + 32}" width="158" height="158" rx="42" fill="url(#glass)"/>
      <circle cx="${caseB.x + 82}" cy="${caseB.y + 82}" r="29" fill="#101715" stroke="#68746e" stroke-width="4"/><circle cx="${caseB.x + 76}" cy="${caseB.y + 76}" r="8" fill="#a8b7b0"/>
      <circle cx="${caseB.x + 148}" cy="${caseB.y + 146}" r="29" fill="#101715" stroke="#68746e" stroke-width="4"/><circle cx="${caseB.x + 142}" cy="${caseB.y + 140}" r="8" fill="#a8b7b0"/>
      <circle cx="${caseB.x + 148}" cy="${caseB.y + 78}" r="10" fill="#e6eddf"/>
      <rect x="${caseB.x - 7}" y="${caseB.y + 270}" width="12" height="80" rx="6" fill="#c5cec9"/>
      <rect x="${caseB.x + caseB.w - 5}" y="${caseB.y + 296}" width="10" height="120" rx="5" fill="#bdc8c2"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">${SCENE_DEFS}${details[category]}</svg>`;
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
