# Prompt Contract

The rules for every `promptTemplate` this skill emits. Distilled from the EcomGen upstream prompt contract and cross-checked against industry practice. Non-negotiable unless the user overrides explicitly.

---

## 1. Prompt order (fixed)

Write prompts in **English**, natural language (not keyword soup), concise. Order:

1. **Campaign Style Lock** — identical verbatim in every shot (multi-shot sets).
2. **Shot type + subject** — `Product photography of {product}` / `E-commerce infographic …`.
3. **Product identity lock** — the verbatim clause (below).
4. **Purpose & mood intent**.
5. **Composition, 机位/景别** (angle named explicitly).
6. **Lighting, color, material, texture** (hex; light direction; color temperature).
7. **Style & realism level**.
8. **Aspect ratio / platform constraint / resolution**.
9. **In-image text (suites with rendered copy only) + negative constraints**.

---

## 2. Iron rules

### 2.1 Colors are hex, never adjectives
"白底" renders light grey; "金色" gives eight golds. Always hex:

- white background → `#FFFFFF`
- dark-grey text → `#2D2D2D`
- gold accent → `#D4AF37`
- light beige → `#F5F1E8`
- deep green → `#1A3A2E`

### 2.2 Product occupancy is a number
| Shot type | Occupancy |
|---|---|
| 白底主图 | 60–70% |
| 卖点副图 | 50–60% |
| 场景氛围图 | 40–50% |
| 信息流广告 | 55–60% |
| 搜索广告 | 65% |
| SKU 多规格 | 70–80% (overall) |
| 细节/微距 | 55–60% (detail fills) |

### 2.3 Every prompt ends with a concrete negative list
Write specific bans, not "no extras":
`Negative: no props, no hands, no watermark, no fake logo, no extra text, no decorative elements, no gradient background, no cut-off edges.`
Add shot-specific bans (e.g. macro: `no blurry subject`; comparison: `no fabricated results`).

### 2.4 Three-layer in-image text (suites with rendered copy only)
- Core promise ≤ 15 chars (headline)
- 2–3 key proof points (icon + short label)
- CTA ≤ 8 chars

### 2.5 Keep it simple
GPT-Image-2 performs best with clear, specific, **concise** prompts — not exhaustive constraint walls. Natural language > keyword lists. Always state light **direction** and **quality**; give color temperature (e.g. `5500K`) for scene shots.

### 2.6 Product-fidelity lock (verbatim, every shot)
> Preserve the exact product identity from the reference image: shape, silhouette, proportions, color, material, surface finish, label/logo placement, and visible construction details. Do not redesign the product. Do not add, remove, or relocate any product feature. Keep the label text exactly legible and unchanged; do not redraw or restyle any logo.

Use image-to-image / reference-conditioned generation, never text-to-image, for a real product.

---

## 3. Campaign Style Lock

The whole-set visual contract, not a mood note. Every shot's prompt begins with the **same** block — never paraphrased, shortened, or synonym-swapped.

**Fields (fill all 10):**
1. 视觉方向 (e.g. `premium tech ecommerce`)
2. 固定色板: 2–3 base + 1 accent, as hex (background / text / accent)
3. 冷暖调: `warm` / `cool` / `neutral`, consistent across the set
4. 字体系统: one family (e.g. `modern geometric sans-serif`); no mixing serif/handwritten/retro/cartoon
5. 背景系统: consistent material/space/depth
6. 光线系统: light direction, shadow strength, reflection quality, mood
7. 布局系统: corner radius, columns, numbering, infographic components
8. 图标/插画系统: line weight, shape, color, complexity (if used)
9. 产品呈现规则: angle, scale, material rendering, centering stability
10. 禁止漂移项: `no color palette changes, no mixed fonts, no random backgrounds, no inconsistent lighting, no mismatched icon styles`

**Default lock (when no brand spec):**
```
Campaign Style Lock: consistent premium ecommerce visual system across the entire image set; fixed palette of clean off-white background #FFFFFF, deep charcoal text #2D2D2D, one product-matched accent color, and one soft secondary accent; neutral-cool studio lighting; modern geometric sans-serif; consistent thin-line icon style; clean high-end product photography mixed with minimal infographic elements; stable product scale and placement; no color palette changes, no mixed fonts, no random backgrounds, no inconsistent lighting, no mismatched icon styles.
```

**Per-shot freedom:** a shot may change only its purpose, subject action, local composition, and short copy. It may **not** change palette, temperature, typography, background system, lighting system, icon style, or label style. If one shot is regenerated, reuse the original lock.

---

## 4. Multi-angle & rhythm rules

AI defaults to front 3/4 — if you don't specify angles, the whole set looks identical. Assign angles explicitly.

**Angles / 机位**
| Angle | Prompt wording | Use |
|---|---|---|
| 正面 3/4 | `at a slight 3/4 angle showing full front facade` | 主图/首图 |
| 正上方俯视 | `photographed directly from above at a 90-degree overhead angle` | layout/平铺 |
| 侧面 90° | `photographed from a clean 90-degree side profile` | depth/侧面细节 |
| 后侧 45° | `photographed from behind at a 45-degree rear angle` | 背面/尾部 |
| 仰视低角度 | `photographed from a very low angle looking upward` | hero/气势 |
| 高角度俯视 | `photographed from a high 45-degree angle looking down` | 顶部/规模 |

**景别**
| Shot size | Prompt wording | Use |
|---|---|---|
| 全景 | `full product visible, product occupies 35-40%` | 主图/场景 |
| 中景 | `showing the [section], product occupies 45-50%` | 功能/结构 |
| 特写 | `tight zoom on [detail], detail occupies 55-60%` | 材质/工艺 |
| 微距 | `extreme close-up macro, shallow depth of field` | 纹理/接缝 |
| 局部 | `close-up detail shot focusing on [part]` | 拉链/标签/接口 |

**Distribution**
- 5-shot main set: ≥3 angles, ≥1 close-up/macro.
- 7–9-shot set: ≥4 angles, ≥2 close-up/macro.
- No 3 consecutive shots at the same angle.
- 全景 ≤ 40% of the set.
- ≥1 俯视 and ≥1 仰视 where possible.
- Every prompt names its angle explicitly.

---

## 5. Detail-page / infographic shots

A detail-page image is **not** a multi-angle product photo — it is an e-commerce **infographic**: headline, icons, labels, comparisons, steps, trust badges. Multi-angle is how the product appears *inside* the infographic, not the goal.

- Start every detail-page prompt with `E-commerce infographic [screen type]`.
- Include: layout keyword (`two-column layout`, `timeline`, `comparison layout`), headline (`headline in #2D2D2D at 28pt reading 「…」`), labels (`label in #7A9E7E at 14pt`), infographic elements (`feature callout icons`, `numbered circles`, `trust badges`, `CTA button with short rendered copy`).
- Per-screen structure: 首屏承接 → 痛点放大 → 机制解释 → 核心利益 → 使用步骤 → 场景覆盖 → 对比选择 → 信任背书 → FAQ/CTA.

---

## 6. Chinese text handling

- Wrap Chinese in 「」 — much higher render accuracy.
- Replace complex-stroke characters with simpler synonyms (95% accuracy is not 100%).
- Font sizes: headline 28–48pt, subtitle 16–20pt, label 10–14pt.
- Keep per-screen text budget ≤ ~50 chars; if the model garbles it, request `clean layout, no dense body text`.
- For trust/credential shots: **do not** generate dense certificates or serial numbers; composite real text in post.

---

## 7. Anti-AI-slop (mandatory)

Common tells to eliminate:
1. **Hands and teeth** — extra/fused fingers, distorted joints/teeth.
2. **Text and logos** — garbled signage, spines, labels, logos.
3. **Lighting logic** — contradictory light directions, impossible/mismatched shadows.
4. **Background repetition** — duplicated textures/objects in the distance; duplicated product elements.
5. **Over-smoothing** — plastic skin, no pores, no imperfections.
6. **Pixel artifacts / proportions** — warped straight lines, ellipses, mismatched scale.
7. **Impossible reflections / floating products** with no contact shadow.

For UGC / lifestyle / 买家秀 looks, use the anti-AI kit:
- specify a phone model (`iPhone 14 Pro` / `iPhone 15 Pro`);
- add visible imperfections (pores, slight noise, warm cast, off-center framing);
- candid language (`NOT professional photography`, `NOT AI-generated look`);
- real, slightly messy environment;
- film tone (`Kodak Portra 400 color feel`);
- `NOT retouched, NOT smoothed`;
- avoid AI-signature words: `perfect`, `flawless`, `stunning`, `hyper-realistic`.

**Never rely on a diffusion model to render a brand mark or precise text from memory** — keep such elements out of the frame.

---

## 8. No-invented-facts rule

Never write certifications, lab numbers, ratings, sales counts, awards, efficacy, or reviews that aren't verifiable. EcomGen must not mask missing inputs or provider failures with fabricated success.
