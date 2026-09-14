# De-identification (脱原图)

The whole point of a suite template is that **another seller can use it with a different product**. Anything that ties the template to the source images or the source brand breaks that and creates trademark/copyright risk. This file defines what to keep and what to strip, plus the audit you must pass.

---

## 1. Keep vs strip

| KEEP (reusable visual grammar) | STRIP (source identity) |
|---|---|
| Shot role & funnel position | Brand name, wordmark, logo, slogan |
| Composition & framing | Model's face / identity / recognizable person |
| Camera angle, 机位, 景别 | The source product's model-specific features |
| Lighting direction & quality | Exact on-image copy / proprietary claims |
| Shadow type & behavior | Unique custom typography / lettering |
| Background / surface material + hex | A distinctive proprietary layout or graphic |
| Color system (hex) | Watermarks, store badges, cert artwork |
| Props & their placement | Exact product packaging/box art |
| Product occupancy, whitespace, text-zone logic | Competitor references / real logos |
| Mood, aesthetic direction, texture language | Source filenames or embedded metadata |

Rule of thumb: **if a phrase would only make sense for the source product or brand, it does not belong in the template.**

---

## 2. The product is always a placeholder

Every promptTemplate refers to the subject as `{product}` — never by name, model, or description of the source item. Scene, composition, lighting, and background are the reusable part; the product is always injected later.

- Good: `Product hero shot of {product}. {product_identity_lock}. Centered front 3/4 on seamless #FFFFFF…`
- Bad: `Hero shot of the beige 5L air fryer with the black dial…`

When a source composition is shaped by the source product's form (e.g. a tall bottle against a vertical backdrop), describe the **generic geometry** (`a tall upright product`) rather than the specific item.

---

## 3. Text handling

- Never reproduce source on-image copy. Rewrite copy as short generic callout placeholders: `{selling_point_1}`, `{callout_1}`.
- Text zones are described positionally, not with source words: `顶部中央留白`, `左侧 40% 干净留白供文案`.
- If the source contains instruction-heavy dense Chinese, keep only the **structural idea** (headline / labels / CTA) and leave the words as placeholders.

---

## 4. People / models

- If the source uses a model, keep only the **role** (`person applying the product`, `hand holding the item`, `full-body lifestyle`). Never carry face identity, ethnicity, or likeness into the template.
- Prefer framing that does not require a recognizable face (hands, back-of-head, cropped), unless the category needs a face (beauty) — then describe a **generic** person, not the source person.

---

## 5. Audit (must pass before output)

Run this on the finished suite JSON:

1. **Search for source product/brand words.** No occurrence anywhere in `name`, `description`, `shots[].displayName`, `intent`, `promptTemplate`, or `styleLock` — except the generic category noun.
2. **Every prompt contains `{product}`** (or `{product_identity_lock}`). No prompt hard-codes a specific item.
3. **No verbatim source copy.** All on-image words are `{…}` placeholders or generic labels.
4. **No model identity.** No reference to a specific person/face from the source.
5. **No logos/watermarks** named or implied.
6. **Text zones are positional**, not content-specific.
7. **Scene/light/background are generic** — reusable with an unrelated product of the same family.
8. **`provenance.detached = true`** with a short note.

If any check fails, fix it and re-run. A suite that leaks the source is not shippable.
