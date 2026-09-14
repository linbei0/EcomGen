# Suite Schema (v1)

The single-artifact contract this skill emits: one JSON object per suite. Field-by-field below, followed by EcomGen mapping notes.

---

## 1. Top level

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | number | yes | `1` |
| `kind` | string | yes | `"ecomgen.suite"` — marks the artifact type |
| `id` | string | yes | `suite-<l1-slug>-<leaf-slug>`, lowercase ascii, hyphenated, stable |
| `name` | string | yes | 6–20 Chinese chars, "款式名" feel (e.g. 「氨基酸温和不紧绷洁面乳款」) |
| `category` | object | yes | see §2 |
| `description` | string | yes | one-line card subtitle: core hook, ≤ 40 Chinese chars |
| `productFamily` | string | yes | one of `fashion, electronics, beauty, food, home, jewelry` (EcomGen family vocabulary) |
| `styleLock` | object | yes | see §3 |
| `shots` | array | yes | see §4; 5–12 items, ordered by `order` |
| `provenance` | object | yes | see §5 |

## 2. `category`

| Field | Type | Notes |
|---|---|---|
| `l1` | string | exact match from `references/category-taxonomy.md` |
| `l2` | string | exact match from `references/category-taxonomy.md` |
| `leaf` | string | free-text concrete product name (product-name granularity; no external id) |
| `leafKeywords` | string[] | 3–8 search keywords |

## 3. `styleLock`

The Campaign Style Lock (see `references/prompt-contract.md`).

| Field | Type | Notes |
|---|---|---|
| `direction` | string | e.g. `premium tech ecommerce` |
| `palette` | array | 2–3 base + 1 accent; each `{ name, hex }` |
| `temperature` | string | `warm` / `cool` / `neutral` |
| `backgroundSystem` | string | consistent background material/space |
| `lightingSystem` | string | direction, quality, shadow, mood |
| `surfaceSystem` | string | tabletop/floor material language |
| `typography` | string | one family + text strategy |
| `iconSystem` | string | icon style, or `none` |
| `presentationRules` | string | angle/scale/centering stability |
| `noDrift` | string[] | explicit anti-drift list |
| `lockText` | string | the assembled English lock, pasted verbatim into each shot |

## 4. `shots[]`

| Field | Type | Required | Notes |
|---|---|---|---|
| `shotId` | string | yes | `shot-01`, `shot-02`, … unique within suite |
| `order` | number | yes | 1-based; funnel order |
| `shotRole` | string | yes | one of `HERO, PAIN_POINT, COMPARISON, SCENE, DETAIL, TRUST, VARIANT, CTA` |
| `displayName` | string | yes | vivid Chinese scene name, 4–20 chars, unique within suite |
| `intent` | string | yes | why this shot converts (1 sentence) |
| `assetType` | string | yes | `<suite id>::<shotId>` — forward-compat with EcomGen `assetType` |
| `mode` | string | yes | `CREATIVE` or `PIXEL_PROTECTED` (default `CREATIVE` for scene/creative shots) |
| `aspectRatio` | string | yes | EcomGen enum: `1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9` |
| `resolution` | string | yes | `1K, 2K, 4K` |
| `camera` | string | yes | 机位/景别, angle named explicitly |
| `lighting` | string | yes | direction + quality (+ color temp) |
| `background` | string | yes | material + hex |
| `props` | string | yes | list or `none` |
| `productOccupancy` | string | yes | e.g. `35-40%` |
| `whitespace` | string | yes | e.g. `>=45%` |
| `textZone` | string | yes | positional description or `none` |
| `promptTemplate` | string | yes | English prompt with placeholders; see `references/prompt-contract.md` |
| `supportsImageReference` | boolean | yes | whether the shot expects a product reference (usually `true`) |

## 5. `provenance`

| Field | Type | Notes |
|---|---|---|
| `sourceKind` | string | `"viral-reference-set"` |
| `sourceImageCount` | number | number of reference images analyzed |
| `detached` | boolean | must be `true` |
| `notes` | string | what was stripped / any caveats |

---

## 6. File naming

- `<l1-slug>-<leaf-slug>.suite.json` (lowercase ascii, hyphenated).
- Example: `护肤个护` + `氨基酸温和洁面乳` → `hufugehu-jiemianru.suite.json`.

---

## 7. EcomGen mapping notes (forward-compat, phase 2)

This skill does **not** modify EcomGen. The schema is designed so integration is mechanical:

- `shots[].shotRole` matches `StoryboardShotRole` exactly (8 enum values).
- `shots[].assetType` = `<suite id>::<shotId>`. EcomGen's `assetType` is currently an immutable ecom-details-image template id; the suite shot id is a natural extension. Phase 2 registers suite shots so `read_ecom_template` can return them and the Agent expands a selected suite into N `StoryboardItem`s.
- `shots[].promptTemplate` is the **direct prompt base** for each storyboard item — it must **not** be re-composed through the legacy 25 single-image templates' promptcontract (per the requirement "套图模版直接走其对应的提示词，不用再经过其他模版").
- `styleLock.lockText` is injected by the Agent as `{style_lock}`; the Agent still personalizes each shot to the user's product and facts.
- Directory convention (phase 2): built-in suites under `packages/ecom-skill/src/suites/`; user drop-in under `ECOMGEN_DATA_DIR/suites/`, auto-discovered.
- Keep `promptInstruction` free of internal markers — the Worker rejects prompts containing upstream template / template-field text.

---

## 8. Minimal example

```jsonc
{
  "schemaVersion": 1,
  "kind": "ecomgen.suite",
  "id": "suite-hufugehu-jiemianru",
  "name": "氨基酸温和不紧绷洁面乳款",
  "category": { "l1": "护肤个护", "l2": "面部护理", "leaf": "氨基酸温和洁面乳", "leafKeywords": ["洁面乳", "氨基酸", "温和"] },
  "description": "氨基酸表活温和清洁、绵密泡沫、洗后不紧绷",
  "productFamily": "beauty",
  "styleLock": { "direction": "clean gentle skincare commerce", "palette": [{ "name": "底白", "hex": "#FFFFFF" }, { "name": "天青强调", "hex": "#7FA7A0" }], "temperature": "neutral", "backgroundSystem": "clean white + soft blush-beige", "lightingSystem": "bright soft studio light, front-left key, soft contact shadow", "surfaceSystem": "matte light-stone counter", "typography": "modern geometric sans-serif", "iconSystem": "none", "presentationRules": "stable 3/4 hero angle", "noDrift": ["no palette changes", "no mixed fonts", "no inconsistent lighting"], "lockText": "Campaign Style Lock: ..." },
  "shots": [
    { "shotId": "shot-01", "order": 1, "shotRole": "HERO", "displayName": "白底洁面乳主图", "intent": "搜索一眼点击", "assetType": "suite-hufugehu-jiemianru::shot-01", "mode": "CREATIVE", "aspectRatio": "1:1", "resolution": "2K", "camera": "straight-on, eye-level, bottle upright", "lighting": "bright high-key front key with soft fill", "background": "#FFFFFF", "props": "none", "productOccupancy": "35-40%", "whitespace": ">=45%", "textZone": "none", "promptTemplate": "Product photography of {product}. {product_identity_lock}. {style_lock}. ...", "supportsImageReference": true }
  ],
  "provenance": { "sourceKind": "viral-reference-set", "sourceImageCount": 8, "detached": true, "notes": "8 张参考图提炼；已剥离品牌字与模特" }
}
```
