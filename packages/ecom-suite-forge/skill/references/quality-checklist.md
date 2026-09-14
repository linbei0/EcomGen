# Quality Checklist

Gate the suite before output. **All P0 must pass.** P1 should pass; P2 is optional polish.

---

## P0 — must pass (block output if any fails)

**Scope & structure**
- [ ] Exactly one suite, one main product, classified by the main product.
- [ ] 5–12 shots, ordered as a conversion funnel (opens HERO, closes TRUST/CTA).
- [ ] `category.l1` / `category.l2` are exact strings from `references/category-taxonomy.md`.
- [ ] `leaf` is free text (no external-id alignment), `leafKeywords` present.

**De-identification**
- [ ] No source brand/logo/slogan/model identity/verbatim copy anywhere (`references/de-identification.md` audit passes).
- [ ] Every `promptTemplate` contains `{product}` (or `{product_identity_lock}`); none hard-codes the source item.
- [ ] `provenance.detached === true`.

**Prompt contract**
- [ ] Every prompt: English, concise, natural language.
- [ ] Colors are hex; no color adjectives ("white"/"gold").
- [ ] Product occupancy is numeric; whitespace is declared.
- [ ] Every prompt ends with a concrete negative list.
- [ ] The product-fidelity lock clause is present in every shot.
- [ ] Same `styleLock.lockText` verbatim in every shot (no paraphrase).

**Facts**
- [ ] No invented certifications, ratings, sales, awards, efficacy, or reviews.
- [ ] Missing proof is labeled `proof placeholder`.

**Set rhythm**
- [ ] ≥3 distinct camera angles; at least one close-up/macro.
- [ ] No 3 consecutive shots share an angle.
- [ ] Full/全景 shots ≤ 40%.
- [ ] Every prompt names its angle explicitly.

**Shot completeness**
- [ ] Every shot has `shotId, order, shotRole, displayName, intent, assetType, mode, aspectRatio, resolution, camera, lighting, background, props, productOccupancy, whitespace, textZone, promptTemplate, supportsImageReference`.
- [ ] `shotRole` values are within the 8-value enum.
- [ ] `displayName` unique within the suite; 4–20 Chinese chars.
- [ ] `assetType` = `<id>::<shotId>`, unique.

**Schema**
- [ ] JSON parses; matches `references/suite-schema.md`.
- [ ] `aspectRatio` ∈ EcomGen enum; `resolution` ∈ {1K,2K,4K}.

---

## P1 — should pass

- [ ] Shot roles are visually distinct, not paraphrased duplicates.
- [ ] Background colors alternate across consecutive shots (visual rhythm).
- [ ] Product occupancy matches the shot type's band.
- [ ] Lifestyle shots read plausible; scale anchor present where helpful.
- [ ] Text zones match platform rules (main image text-free on Amazon/Taobao).
- [ ] Anti-AI-slop tells addressed (hands, text, light logic, repetition, floating).
- [ ] `productFamily` is the closest of the 6 families.

---

## P2 — nice to have

- [ ] Platform-specific aspect/resolution recorded where the user named a platform.
- [ ] A `VARIANT` shot for products with obvious variants.
- [ ] Suggested test priority (which shot to A/B first).

---

## Anti-AI-slop final scan

Before handing off, verify no shot prompt would produce:

- garbled in-image text or fake logos,
- deformed hands/fingers or teeth,
- contradictory light directions / impossible shadows,
- duplicated background textures or duplicated product parts,
- floating product with no contact shadow,
- over-smoothed plastic surfaces.

If any is likely, tighten the prompt (add the specific negative, declare light direction, declare contact shadow).
