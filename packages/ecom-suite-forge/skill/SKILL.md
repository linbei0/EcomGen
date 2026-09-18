---
name: ecom-suite-forge
description: Turn one complete set of viral/hit e-commerce product images (爆款套图) into a single reusable EcomGen suite template (套图模版): classify by L1/L2 category, decompose into a conversion-ordered storyboard, and write per-shot prompt templates that are fully detached from the original images so they can later be reused with any user product photo. Use when the user supplies a folder/set of 爆款电商图片 and asks to 拆解/提炼/复刻成套图模版, or wants to build or expand a 套图库.
---

# ECOM SUITE FORGE

You take **one complete set of viral e-commerce images** and reverse-engineer it into **one reusable suite template (套图模版)**.

The suite template is **not** a copy of the source images. It is the *visual grammar* of the set — shot roles, composition, camera, lighting, background, color system, text strategy — rewritten as generic, placeholder-driven prompt templates. At generation time the pipeline is:

```
user product photo (Product Truth)
   + suite template (N storyboard shots)
        -> Agent rewrites each shot with the user's product facts
   -> N final image prompts
        -> the user's own professional, high-CTR product image set
```

So every template you emit must satisfy: **swap in a different product, and it still works.**

---

## SCOPE

**In:**
- One set of reference images (ideally 6–12, one main product) → one suite template JSON.
- Classify the suite by category `L1`/`L2` (from `references/category-taxonomy.md`) plus a free-text `leaf`.
- Emit `references/suite-schema.md`-conformant JSON, saved to the user's chosen directory.

**Out (do NOT do):**
- Do not generate images. This skill only forges templates.
- Do not touch the EcomGen codebase; the template is a data artifact for later integration.
- Do not process multiple sets at once. One set, one suite. If the user gives many, do them one by one.
- Do not align `leaf` to any external id; it is free text at product-name granularity.

If the user gives only a single image, say so and ask for the **whole set** — a suite needs multiple shots to be meaningful. Minimum useful is ~5; 6–12 is ideal.

---

## IRON RULES (every suite must satisfy all)

1. **One suite = one main product.** Classify by the main product. If the set is genuinely mixed (e.g. tent + mug + watch), tell the user it is impure and recommend splitting into two suites.
2. **Detach from the source.** Extract only reusable visual grammar. Never let source brand, logo, model identity/face, source on-image copy, unique typography, or model-specific features into the template. See `references/de-identification.md`.
3. **Order is a conversion funnel, not a pile of images.** Sequence shots so they convince: click → benefit → pain → proof → scene → detail → trust → variant → close.
4. **Every shot is fully specified.** A shot without 机位/景别/光位/背景/台面/道具/产品占比 is incomplete.
5. **Prompt contract.** English, natural language, concise. Hex colors (never color words). Numeric product occupancy. A negative list on every prompt. Chinese in-image text wrapped in 「」, only for suites that explicitly ask for rendered in-image copy. Full rules in `references/prompt-contract.md`.
6. **Whole-set consistency.** Build one **Campaign Style Lock** and reuse it verbatim in every shot; vary angle/background/shot purpose so the set does not look like one photo repeated. See `references/prompt-contract.md`.
7. **No invented facts.** Never write certifications, lab numbers, ratings, sales counts, or efficacy claims that are not verifiable from the images or the user. Use `proof placeholder` instead. EcomGen forbids fabricated success.
8. **Category comes from the built-in list.** `L1` and `L2` must be exact strings from `references/category-taxonomy.md`. `leaf` is your own free-text product name.

---

## WORKFLOW

Run the phases in order. Do not skip the analysis worksheet.

### Phase 0 — Intake
- Require a **whole set** (folder / batch). Confirm the **main product**, and infer (don't over-ask) the target **platform/market** and any brand tone or forbidden elements.
- Ask at most 3 questions, only where the answer changes the template. If you can infer confidently, declare your assumption and proceed.

### Phase 1 — Read the set & classify
- Look at **every** image first, then judge the main product.
- Collect selling points / pain points **visible in the images** (do not invent).
- Choose exact `L1`/`L2` from `references/category-taxonomy.md`; write a free-text `leaf` (the concrete product, e.g. 「氨基酸温和洁面乳」).

### Phase 2 — Decompose each image (the core step)
For each source image, fill the worksheet in `assets/analysis-worksheet.md`:
- funnel role → `shotRole` (see mapping below);
- composition / 机位 / 景别;
- light direction & quality, shadow type;
- background / surface material & hex;
- props & placement;
- product occupancy, text-zone position (for suites with in-image copy);
- color system (dominant + accent hex);
- **"source-specific elements to strip"** list (brand, face, exact copy, unique layout).
Merge duplicate roles, and drop images that carry no information (pure decoration, near-identical duplicates).

### Phase 3 — Derive the Campaign Style Lock
Summarize the set into one visual contract: palette (2–3 base + 1 accent, as hex), warm/cool tone, background system, lighting system, surface/material language, typography & text strategy, icon style, product-presentation rules, and explicit "no drift" items. Store it in `styleLock`.

### Phase 4 — Write each shot's `promptTemplate`
Use the fixed order from `references/prompt-contract.md`:
`[shot type] of {product}. {product_identity_lock}. {style_lock}. [composition/机位/景别]. [light/shadow]. [background/surface hex]. [props]. [occupancy]. [text zone, for suites with in-image copy]. [quality]. Negative: [...]`

Use only these placeholders: `{product}`, `{product_identity_lock}`, `{style_lock}`, `{selling_point_1..n}`, `{callout_1..n}`, `{accent_color}`. Nothing else may be source-specific. `{selling_point_*}`/`{callout_*}` only appear in suites that carry in-image copy.

### Phase 5 — Assemble the suite JSON
Follow `references/suite-schema.md` exactly. Assign `shotId`, `assetType`, `order`, `shotRole`, `displayName`, `intent`, `aspectRatio`, `resolution`, and the per-shot visual fields.

### Phase 6 — De-identify + QA gate
Run `references/quality-checklist.md`. **All P0 items must pass.** If any P0 fails, fix and re-run. Then run the de-identification audit in `references/de-identification.md`.

### Phase 7 — Output
- File name: `<l1-slug>-<leaf-slug>.suite.json` (lowercase ascii slugs; see schema doc).
- Write to the directory the user asked for; if unspecified, propose one and confirm.
- Report back: suite name, category, shot count, a one-line summary per shot, assumptions, and open questions.

---

## SHOT ROLE MAPPING (industry shot type → EcomGen `shotRole`)

EcomGen defines exactly 8 immutable roles: `HERO, PAIN_POINT, COMPARISON, SCENE, DETAIL, TRUST, VARIANT, CTA`. Map the industry image types onto them:

| Industry image type | `shotRole` | Purpose |
|---|---|---|
| 白底主图 / hero / packshot | `HERO` | Win the click in search |
| 卖点图（强视觉主张） | `HERO` | Communicate the #1 benefit in ~1s |
| 卖点图（结构 / 材质 / 工艺） | `DETAIL` | Prove how it works |
| 痛点图 | `PAIN_POINT` | Agitate the problem |
| 前后对比 / 竞品对比 | `COMPARISON` | Prove the result |
| 场景图 / 使用图 / 买家秀 | `SCENE` | Self-projection |
| 细节 / 微距 / 材质 | `DETAIL` | Prove quality |
| 尺寸 / 规格 / 信息图 | `DETAIL` | Remove size doubts |
| 资质 / 质检 / 信任 / 包装 | `TRUST` | Remove risk |
| 多规格 / 多色 / 套装 | `VARIANT` | Let them choose |
| 促销 / 优惠 / 收口 | `CTA` | Close |

Rules:
- Prefer `HERO` for the opening shot; end with `CTA` or `TRUST` depending on the driver.
- A role may repeat, but each repeat must be a **different shot** (different scene, not a paraphrased duplicate).
- The `displayName` is the vivid Chinese scene name; keep 4–20 Chinese characters and make it distinct within the suite. Put the longer explanation in `intent`.

---

## CATEGORY & NAMING

- `category.l1`, `category.l2`: exact strings from `references/category-taxonomy.md`.
- `category.leaf`: your free-text concrete product name (no external-id alignment).
- `category.leafKeywords`: 3–8 search keywords (product name, key feature, use scenario).
- `id`: `suite-<l1-slug>-<leaf-slug>`, lowercase ascii, hyphenated, stable.
- `name`: 6–20 Chinese characters, a "款式名" feel (e.g. 「氨基酸温和不紧绷洁面乳款」), following a `<sellable descriptor>+款` pattern.

---

## OUTPUT SHAPE (summary)

```jsonc
{
  "schemaVersion": 1,
  "kind": "ecomgen.suite",
  "id": "suite-hufugehu-jiemianru",
  "name": "氨基酸温和不紧绷洁面乳款",
  "category": { "l1": "护肤个护", "l2": "面部护理", "leaf": "氨基酸温和洁面乳", "leafKeywords": ["洁面乳","氨基酸","温和"] },
  "description": "氨基酸表活温和清洁、绵密泡沫、洗后不紧绷",
  "productFamily": "beauty",
  "styleLock": { "...": "Campaign Style Lock" },
  "shots": [
    { "shotId": "shot-01", "order": 1, "shotRole": "HERO", "displayName": "...", "intent": "...",
      "assetType": "suite-...::shot-01", "aspectRatio": "1:1", "resolution": "2K",
      "camera": "...", "lighting": "...", "background": "...", "props": "...",
      "productOccupancy": "60-70%", "whitespace": "none", "textZone": "none",
      "promptTemplate": "..." }
  ],
  "provenance": { "sourceKind": "viral-reference-set", "sourceImageCount": 8, "detached": true, "notes": "..." }
}
```

Full field contract: `references/suite-schema.md`. A complete worked example: `assets/suite-template.example.json`.

---

## REFERENCE FILES

- `references/category-taxonomy.md` — built-in L1/L2 list (source of truth for classification).
- `references/shot-playbook.md` — per-shot purpose, composition, camera, lighting, background, occupancy, and prompt recipe.
- `references/prompt-contract.md` — GPT-Image-2 prompt iron rules, Campaign Style Lock, multi-angle & rhythm rules, anti-AI-slop.
- `references/de-identification.md` — what must be stripped from the source, and the audit.
- `references/suite-schema.md` — the suite JSON schema (v1) and EcomGen mapping notes.
- `references/quality-checklist.md` — P0/P1/P2 gate.
- `assets/analysis-worksheet.md` — per-image analysis worksheet.
- `assets/suite-template.example.json` — a complete example suite.
