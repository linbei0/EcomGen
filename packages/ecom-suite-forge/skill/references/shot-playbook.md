# Shot Playbook

Per-shot purpose, composition, camera, lighting, background, and a prompt recipe for each shot type. Use with the `shotRole` mapping in `SKILL.md`.

---

## 1. Default conversion-ordered set

Aim for this order unless the reference set clearly dictates otherwise. Drop shots that don't fit the product; keep the funnel shape.

| # | Shot (行业) | `shotRole` | Job in the funnel |
|---|---|---|---|
| 1 | 白底主图 / packshot | HERO | Win the search click; platform-compliant |
| 2 | 卖点图 (核心利益) | HERO | One-second core benefit |
| 3 | 痛点图 | PAIN_POINT | Agitate the problem |
| 4 | 场景图 / 使用图 | SCENE | Let the buyer project themselves |
| 5 | 细节 / 微距 | DETAIL | Prove material & craft |
| 6 | 对比图 (前后/竞品) | COMPARISON | Prove the result |
| 7 | 尺寸 / 规格 | DETAIL | Answer "how big / which one" |
| 8 | 信任 / 资质 / 质检 | TRUST | Remove risk |
| 9 | 包装 / 全家福 | TRUST | What's in the box |
| 10 | 促销 / CTA | CTA | Close |

**Driver adaptations** (choose one driver first, then weight the set):
- **视觉驱动型** (appearance-driven: beauty, jewelry, fashion, gifts): lean on texture, hero, detail, scene, gift feel.
- **痛点驱动型** (problem-driven: tools, cleaning, health, kitchen): strict order 问题 → 机制 → 利益证明 → 信任 → CTA.
- **情感价值驱动型** (identity/emotion: baby, pets, hobby, lifestyle): emotion hook → identity → product as enabler → social proof → low-friction CTA.

**标品 vs 非标品**: standard goods sell **function**; non-standard sell **scenario/aspiration**.

---

## 2. Per-shot recipes

Each recipe gives: **Purpose · Composition · Camera/机位 · 景别 · Lighting/光位 · Shadow · Background · Props · Occupancy · Whitespace · Text zone · Prompt recipe · High-CTR key · Failure to avoid.**

### 2.1 HERO — 白底主图 / packshot
- **Purpose:** click-through in search; marketplace compliance.
- **Composition:** centered, symmetrical, product is the only subject.
- **Camera:** eye-level or slight 3/4 (15–30°); full product visible, not clipped by frame.
- **Lighting:** bright even high-key; softbox front-left + fill/bounce card on the shadow side.
- **Shadow:** soft **contact shadow** only — it grounds the product; avoid floating.
- **Background:** seamless pure white `#FFFFFF` (or true brand hex); no props.
- **Occupancy:** 35–40% (35–40% is the sweet spot; Amazon-style fills ~85% — pick per platform).
- **Whitespace:** `>=45%`.
- **Text zone:** none (main image must be text-free on Amazon/Taobao).
- **Prompt recipe:**
  `Product photography of {product}. {product_identity_lock}. {style_lock}. Centered front 3/4 view, full product visible, eye-level. Bright even high-key studio lighting, soft front-left key with fill, soft contact shadow grounding the product. Seamless pure white background #FFFFFF. Product occupies 35-40% of frame, whitespace at least 45%. 8K, commercial e-commerce quality. Negative: no props, no hands, no watermark, no fake logo, no extra text, no decorative elements, no cut-off edges.`
- **High-CTR key:** crisp edges, clean silhouette, no distraction.
- **Avoid:** colored/tinted background (use hex), product too small, prop clutter, in-frame shouting text.

### 2.2 HERO — 卖点图 (核心利益, visual claim)
- **Purpose:** state the #1 reason to buy in ~1 second (**主图一秒法则**).
- **Composition:** product dominant + generous negative space reserved for a short callout.
- **Camera:** same hero angle as 2.1 for family consistency.
- **Lighting:** matches style lock; may add an accent light to spotlight the hero feature.
- **Background:** brand background or a clean tinted panel (`#F5F1E8`, `#1A3A2E`…), one panel only.
- **Occupancy:** 25–30% (leave room for copy).
- **Whitespace:** `>=45%`.
- **Text zone:** explicit — e.g. `顶部中央 200×100 留空（价格叠加区）`, `左侧 40% 干净留白供文案`.
- **Prompt recipe:** add `{selling_point_1}` and `{callout_1}` placeholders. `E-commerce benefit hero on {background hex}. Top headline in #2D2D2D reading 「{callout_1}」. {product} shown {camera}, occupying 25-30%, whitespace at least 45%. [lighting]. Negative: [...]`
- **High-CTR key:** one idea only, legible in a glance.
- **Avoid:** multiple claims, dense paragraphs, tiny fake text.

### 2.3 PAIN_POINT — 痛点图
- **Purpose:** agitate the concrete problem the product solves.
- **Composition:** split/contrast framing (problem left → product solution right) or an "everyday friction" candid.
- **Camera:** documentary, slightly handheld feel; product appears at the resolution moment.
- **Lighting:** directional / lower-key to feel heavier on the problem side.
- **Background:** relatable messy real context (do NOT clean it up).
- **Props:** only props that embody the pain.
- **Occupancy:** 20–25% (context is the point).
- **Whitespace:** keep a caption strip.
- **Text zone:** short pain label + short solution label.
- **Prompt recipe:** `E-commerce pain-point split screen. Left: {pain scene from the source set}. Right: {product} solving it. ... Negative: no extra text, no watermark.`
- **High-CTR key:** specific, recognizable problem (mine it from reviews/客服).
- **Avoid:** vague "feeling bad", fabricated statistics.

### 2.4 SCENE — 场景图 / 使用图 / 买家秀
- **Purpose:** self-projection; show the product in a plausible life.
- **Composition:** product prominent but embedded; lifestyle environment is the co-star.
- **Camera:** eye-level or 3/4 in-context; occasionally handheld candid.
- **Lighting:** natural window light or golden hour; keep direction consistent with props' shadows.
- **Background:** real room/outdoor; **props must not cover the product**.
- **Props:** max 2–3, relevant; add a scale anchor (e.g. a standard 12oz mug).
- **Occupancy:** 20–25%.
- **Whitespace:** >=50%; scene breathing room.
- **Text zone:** usually none; optional short lower-third caption.
- **Prompt recipe:** `Lifestyle scene: {product} in {scene from source} environment. {style_lock}. {camera}. {natural light}. On {surface}. {props}. Product occupies 20-25%, whitespace at least 50%. Negative: no hands covering product, no extra text, no watermark, no fake logo.`
- **High-CTR key:** aspirational yet believable; product still clearly the subject.
- **Avoid:** cluttered scene, product lost in the frame, impossible shadows.

### 2.5 DETAIL — 细节 / 微距 / 材质
- **Purpose:** prove material, craft, construction.
- **Composition:** tight crop on one feature; shallow depth of field.
- **Camera:** macro / close-up; `f/2.8–4.5` shallow DOF, foreground sharp.
- **Lighting:** side/raking light to reveal texture; controlled highlight.
- **Shadow:** soft to dramatic depending on material.
- **Background:** neutral, uncluttered, complementary.
- **Occupancy:** detail occupies 55–60% (or macro fill).
- **Whitespace:** low; detail is the whole point.
- **Text zone:** small annotation labels only.
- **Prompt recipe:** `Extreme close-up macro of {product}, tight zoom on {specific detail}. {style_lock}. Shallow depth of field, foreground sharp. Raking side light revealing texture. Neutral {surface} background. Detail occupies 55-60%. Negative: no blurry subject, no extra text, no watermark.`
- **High-CTR key:** visible seams, weave, hardware, finish.
- **Avoid:** showing a detail that isn't actually the product's.

### 2.6 COMPARISON — 对比图 / 前后
- **Purpose:** prove the delta (before/after or "ordinary vs ours").
- **Composition:** matched side-by-side framing; identical camera & crop both sides.
- **Camera/lighting:** **identical** on both sides — only the subject state differs.
- **Background:** same on both sides, or clean two-panel.
- **Occupancy:** balanced across both panels.
- **Text zone:** two clear labels (before/after, ordinary/ours).
- **Prompt recipe:** `E-commerce before-and-after comparison, two matched panels with identical framing and lighting. Left: {before}. Right: {after with product}. ... Negative: no fabricated results, no extra text, no watermark.`
- **High-CTR key:** honest, visible, specific delta.
- **Avoid:** fake or exaggerated results; misaligned framing.

### 2.7 DETAIL — 尺寸 / 规格 / 信息图
- **Purpose:** answer dimensions and specs; kill "will it fit?" doubt.
- **Composition:** product + reference object, or dimension callouts, or a structured spec list.
- **Camera:** hero angle or overhead depending on product.
- **Lighting:** even, flat, readable.
- **Background:** clean light (`#FAF7F2`/`#FFFFFF`).
- **Text zone:** dimension lines and 2–4 short labels.
- **Prompt recipe:** `E-commerce size spec screen on {background hex}. {product} shown {camera} with dimension callouts in #2D2D2D. Labels reading 「{callout_1}」… Product occupies 45-50%. Clean structured layout. Negative: no dense body text, no watermark.`
- **High-CTR key:** overlay cm/in, hand or common object as scale anchor.
- **Avoid:** unreadable tiny text; missing units.

### 2.8 TRUST — 信任 / 资质 / 质检 / 包装
- **Purpose:** remove risk; set expectations (certifications, warranty, what's in the box).
- **Composition:** product + badge/seal, or top-down flat-lay of the full contents.
- **Camera:** flat/overhead for packaging; straight-on for badges.
- **Lighting:** even high-key; clean.
- **Background:** white or light neutral.
- **Text zone:** short trust labels.
- **Prompt recipe:** `E-commerce trust screen. {product} with clean trust badges and short labels 「{callout_1}」. {background hex}. Even studio light. Negative: do NOT invent certifications, awards, ratings, or test data; no fake logos, no watermark.`
- **High-CTR key:** ratings, certs, real UGC — **only if real**; otherwise use `proof placeholder`.
- **Avoid:** fabricated authority. This is a hard rule.

### 2.9 VARIANT — 多规格 / 多色 / 套装
- **Purpose:** let the buyer choose; show range.
- **Composition:** grid or row of variants on a consistent background.
- **Camera/lighting:** identical across variants (same hero angle, same light).
- **Background:** one consistent background; hex-pin each variant color.
- **Occupancy:** 60–70% overall (multi-item).
- **Prompt recipe:** `E-commerce variant grid. {product} shown in {variant_1}, {variant_2}, {variant_3} (hex-pinned), consistent hero angle and lighting across all. {background hex}. Negative: no mixed lighting, no extra text, no watermark.`
- **High-CTR key:** accurate colors (hex/Pantone), consistent presentation.
- **Avoid:** texture loss on dark colors; lighting drift between variants.

### 2.10 CTA — 促销 / 收口
- **Purpose:** close with offer + action.
- **Composition:** product + offer burst / CTA button placeholder.
- **Lighting:** brand-consistent, slightly punchier.
- **Background:** brand key color.
- **Text zone:** headline + CTA button placeholder.
- **Prompt recipe:** `E-commerce promo close. {product} with a CTA button placeholder and short headline 「{callout_1}」. {brand hex} background. {lighting}. Negative: no invented discounts or claims, no watermark.`
- **High-CTR key:** urgency with a real offer only.
- **Avoid:** fake countdowns, fabricated discounts.

---

## 3. Platform targets (keep as data)

Use to pick `aspectRatio`/`resolution` and background/text rules. **Verify unconfirmed values against official seller help before hard-coding.**

| Platform | Main image | Notes |
|---|---|---|
| Amazon | 1:1, pure white `#FFFFFF`, product fills ~85%, ≥1600px long side for zoom (min 1000px) | Main image must be a real photo: **no text, logos, graphics, props, watermarks**; up to 9 images, first 7 shown |
| Shopify | 1:1, recommended 2048×2048 | Themes zoom; below 2048 makes zoom hard |
| Taobao / Tmall | 800×800 main, ≥1 白底图; mobile vertical 2:3 (800×1200); detail width 750/790px | 白底图: single subject, fills frame, no logo/text/model; slices 960–1100px, each ≤500KB |
| Shein / Temu / TikTok Shop | commonly 1:1 white-background main | **unverified here — confirm before relying on numbers** |

Aspect ratios must be one of EcomGen's enum values: `AUTO, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9`. Resolution ∈ `1K, 2K, 4K`.

---

## 4. Set rhythm (multi-shot consistency)

- **Never three consecutive shots with the same angle.** Assign ≥3 distinct angles across a 5–9 shot set.
- **Full/全景 shots ≤ 40%** of the set; interleave mid-shots, close-ups, macro for rhythm.
- **At least one 俯视 (overhead) and one 仰视/低角度 (low angle)** where the product allows.
- **Alternate background colors** across consecutive shots (e.g. `#FFFFFF` → `#F5F1E8` → brand dark) to avoid visual fatigue.
- **Keep the hero angle consistent** across variants and scenes so the product reads as the same object.
- Every prompt must **name its angle explicitly** (`side profile`, `from above`, `low angle`) — models default to 3/4 if you don't.

---

## 5. Category-specific notes

| Family | Emphasize | Light/background | Watch out |
|---|---|---|---|
| food | freshness, texture, appetite appeal | soft top light, soft contact shadow | don't make it look plastic |
| beauty | texture, glow, formula | clamshell/butterfly, shadowless | over-retouched skin, fake claims |
| fashion | fabric drape, stitching | soft 3/4, subtle contact shadow | body proportions, mannequin rules |
| electronics | finish, ports, screen | soft diffused + rim | warped straight lines, fake UI |
| home | material, craftsmanship | soft 3/4, natural | scale inconsistency |
| jewelry | macro cut & sparkle | lightbox tent, controlled reflection | impossible sparkle, fake gems |

These map to the families in `productFamily`: `food, beauty, fashion, electronics, home, jewelry`. Use the closest one.
