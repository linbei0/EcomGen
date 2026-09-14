// 自动生成文件：由 scripts/generate-suite-manifest.mjs 从 src/suites/ 生成，请勿手改。
// 重新生成：pnpm --filter @ecomgen/ecom-suite gen:suites
export default {
  "totalHash": "1236fcdfa88854b99f0ab19c3cd45eb2ca821f58c3a1b2aee30a97bdab8089d9",
  "suites": [
    {
      "file": "01-skincare-cleanser.suite.json",
      "hash": "4309f02819002c1334dfeac335cb9052a72c1d10d3a78bec91eac1c791bc48b2",
      "data": {
        "schemaVersion": 1,
        "kind": "ecomgen.suite",
        "id": "suite-hufugehu-jiemianru",
        "name": "氨基酸温和不紧绷洁面乳款",
        "category": {
          "l1": "护肤个护",
          "l2": "面部护理",
          "leaf": "氨基酸温和洁面乳",
          "leafKeywords": [
            "洁面乳",
            "氨基酸",
            "温和",
            "敏感肌",
            "不紧绷"
          ]
        },
        "description": "氨基酸表活温和清洁、绵密泡沫、洗后不紧绷",
        "productFamily": "beauty",
        "styleLock": {
          "direction": "clean gentle skincare commerce",
          "palette": [
            {
              "name": "底白",
              "hex": "#FFFFFF"
            },
            {
              "name": "柔粉杏背景",
              "hex": "#F6EFEA"
            },
            {
              "name": "天青强调",
              "hex": "#7FA7A0"
            },
            {
              "name": "炭灰文字",
              "hex": "#33383D"
            }
          ],
          "temperature": "neutral",
          "backgroundSystem": "clean white #FFFFFF for packshots, soft blush-beige #F6EFEA for info and scene shots",
          "lightingSystem": "bright soft studio lighting, front-left key with fill, soft contact shadows, no harsh speculars",
          "surfaceSystem": "matte light-stone counter #E7E2DC and neutral matte board #EFE9E1",
          "typography": "modern geometric sans-serif headline placeholders only",
          "iconSystem": "thin-line icons only, single accent color",
          "presentationRules": "stable slight 3/4 hero angle and scale for the product across the set",
          "noDrift": [
            "no color palette changes",
            "no mixed fonts",
            "no random backgrounds",
            "no inconsistent lighting",
            "no mismatched icon styles"
          ],
          "lockText": "Campaign Style Lock: consistent clean gentle skincare visual system across the entire image set; fixed palette of clean white background #FFFFFF, soft blush-beige #F6EFEA, charcoal text #33383D and one teal accent #7FA7A0; bright soft studio lighting with front-left key and soft contact shadows; modern geometric sans-serif headline placeholders only; consistent rounded info labels; consistent thin-line icon style; clean high-end skincare photography mixed with minimal infographic elements; stable slight 3/4 hero product angle and scale; generous whitespace; no color palette changes, no mixed fonts, no random backgrounds, no inconsistent lighting, no mismatched icon styles."
        },
        "shots": [
          {
            "shotId": "shot-01",
            "order": 1,
            "shotRole": "HERO",
            "displayName": "白底洁面乳主图",
            "intent": "搜索列表一眼点击，干净合规",
            "assetType": "suite-hufugehu-jiemianru::shot-01",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "straight-on eye-level, bottle standing upright, full product visible",
            "lighting": "bright even high-key studio lighting, front key with soft fill",
            "background": "seamless pure white #FFFFFF",
            "props": "none",
            "productOccupancy": "35-40%",
            "whitespace": ">=45%",
            "textZone": "none",
            "promptTemplate": "Product photography of {product}. {product_identity_lock}. {style_lock}. The bottle standing upright, straight-on eye-level view, full product visible. Bright even high-key studio lighting with a front key and soft fill, a soft contact shadow grounding the product. Seamless pure white background #FFFFFF. The product occupies 35-40% of the frame, whitespace at least 45%. 8K, commercial beauty e-commerce quality. Negative: no props, no hands, no watermark, no fake logo, no extra text, no cut-off edges.",
            "supportsImageReference": true
          },
          {
            "shotId": "shot-02",
            "order": 2,
            "shotRole": "HERO",
            "displayName": "氨基酸温和卖点图",
            "intent": "一秒说清温和清洁的核心利益，主图一秒法则",
            "assetType": "suite-hufugehu-jiemianru::shot-02",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "slight 3/4 hero angle, product on the left",
            "lighting": "soft front-left key light, soft contact shadow",
            "background": "soft blush-beige #F6EFEA",
            "props": "one thin-line icon",
            "productOccupancy": "25-30%",
            "whitespace": ">=45%",
            "textZone": "right side clean negative space for one short headline placeholder 「{callout_1}」 in #33383D",
            "promptTemplate": "E-commerce benefit hero of {product}. {product_identity_lock}. {style_lock}. The product shown at a slight 3/4 hero angle on the left, occupying 25-30%. Right side clean negative space carrying one short headline placeholder 「{callout_1}」 in #33383D and one thin-line icon in {accent_color}. Background soft blush-beige #F6EFEA, soft front-left key light, soft contact shadow. Whitespace at least 45%. Negative: no dense body text, no more than one claim, no invented efficacy claims, no watermark, no fake logo, no props covering the product.",
            "supportsImageReference": true
          },
          {
            "shotId": "shot-03",
            "order": 3,
            "shotRole": "PAIN_POINT",
            "displayName": "皂基洁面紧绷泛红痛点",
            "intent": "放大紧绷、泛红、越洗越干的痛点",
            "assetType": "suite-hufugehu-jiemianru::shot-03",
            "mode": "CREATIVE",
            "aspectRatio": "4:5",
            "resolution": "2K",
            "camera": "matched split-screen framing, identical on both panels",
            "lighting": "left panel harsh and drying; right panel soft and gentle",
            "background": "soft blush-beige #F6EFEA on both panels",
            "props": "none",
            "productOccupancy": "25-30% per panel",
            "whitespace": ">=40%",
            "textZone": "one short label per panel 「{callout_1}」 / 「{callout_2}」",
            "promptTemplate": "E-commerce pain-point split screen, two matched panels with identical camera and framing. Left panel: an abstract patch of tight, dull, irritated skin under harsh flat light, conveying post-cleanse tightness without showing a real face. Right panel: {product} in soft gentle light conveying comfort. {product_identity_lock}. {style_lock}. Background soft blush-beige #F6EFEA on both panels, soft top light. Each panel carries one short label placeholder 「{callout_1}」 and 「{callout_2}」. The product occupies 25-30% per panel. Negative: no real model face, no fabricated claims or statistics, no extra text, no watermark, no fake logo.",
            "supportsImageReference": true
          },
          {
            "shotId": "shot-04",
            "order": 4,
            "shotRole": "SCENE",
            "displayName": "清晨洁面水汽场景",
            "intent": "代入真实使用场景，营造清爽舒适",
            "assetType": "suite-hufugehu-jiemianru::shot-04",
            "mode": "CREATIVE",
            "aspectRatio": "3:4",
            "resolution": "2K",
            "camera": "slight 3/4 eye-level, candid handheld feel over a bathroom counter",
            "lighting": "soft morning window light from the left, 5500K, gentle mist, soft contact shadow",
            "background": "matte light-stone bathroom counter #E7E2DC with soft mist",
            "props": "a folded towel and a small tray, not covering the product",
            "productOccupancy": "20-25%",
            "whitespace": ">=50%",
            "textZone": "none",
            "promptTemplate": "Lifestyle scene: {product} resting on a matte light-stone bathroom counter #E7E2DC with a soft morning mist around it. {product_identity_lock}. {style_lock}. Photographed at a slight 3/4 eye-level with a candid handheld feel. Soft morning window light from the left, 5500K, gentle mist, soft contact shadow. Props: a folded towel and a small tray, not covering the product. The product occupies 20-25% of the frame, whitespace at least 50%. Negative: no visible face, no hands covering the product, no extra text, no watermark, no fake logo, no messy clutter.",
            "supportsImageReference": true
          },
          {
            "shotId": "shot-05",
            "order": 5,
            "shotRole": "DETAIL",
            "displayName": "绵密泡沫微距",
            "intent": "用细腻泡沫证明温和亲肤",
            "assetType": "suite-hufugehu-jiemianru::shot-05",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "extreme close-up macro, shallow depth of field, foreground sharp",
            "lighting": "raking side light from the right revealing fine foam texture",
            "background": "neutral matte board #EFE9E1",
            "props": "none",
            "productOccupancy": "detail fills 55-60%",
            "whitespace": "minimal, detail is the subject",
            "textZone": "none",
            "promptTemplate": "Extreme close-up macro of dense fine foam pumped from {product}, tight zoom on the foam surface. {product_identity_lock}. {style_lock}. Shallow depth of field with the foreground sharp. Raking side light from the right revealing fine foam texture. Neutral matte board background #EFE9E1. The detail fills 55-60% of the frame. Negative: no blurry subject, no extra text, no watermark, no fake logo, no props.",
            "supportsImageReference": true
          },
          {
            "shotId": "shot-06",
            "order": 6,
            "shotRole": "DETAIL",
            "displayName": "成分与规格信息图",
            "intent": "讲清成分与容量，消除规格疑虑",
            "assetType": "suite-hufugehu-jiemianru::shot-06",
            "mode": "CREATIVE",
            "aspectRatio": "3:4",
            "resolution": "2K",
            "camera": "flat lay, top-down 90-degree, product upright in frame",
            "lighting": "even high-key flat lighting, no dramatic shadow",
            "background": "soft blush-beige #F6EFEA",
            "props": "a few empty rounded label areas as info placeholders",
            "productOccupancy": "40-45%",
            "whitespace": ">=35%",
            "textZone": "stacked information areas: core promise 「{callout_1}」, 2-3 evidence lines, capacity badge",
            "promptTemplate": "E-commerce infographic layout for {product}, flat lay shot from a top-down 90-degree angle with the product upright. {product_identity_lock}. {style_lock}. Even high-key flat lighting, no dramatic shadow. Background soft blush-beige #F6EFEA. A few empty rounded label areas left blank as info placeholders: a core promise 「{callout_1}」 in #33383D, two or three short evidence lines, and a capacity badge. The product occupies 40-45%, whitespace at least 35%. Negative: no tiny unreadable text, no fabricated ingredient claims, no watermark, no fake logo.",
            "supportsImageReference": true
          },
          {
            "shotId": "shot-07",
            "order": 7,
            "shotRole": "TRUST",
            "displayName": "敏感肌温和无添加信任",
            "intent": "降风险，强调温和无添加",
            "assetType": "suite-hufugehu-jiemianru::shot-07",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "clean 3/4 product angle beside a badge area",
            "lighting": "even clean studio light",
            "background": "pure white #FFFFFF",
            "props": "one empty seal-shaped badge area as a proof placeholder",
            "productOccupancy": "30-35%",
            "whitespace": ">=40%",
            "textZone": "two short trust labels 「{callout_1}」 and 「{callout_2}」 in #33383D",
            "promptTemplate": "E-commerce trust screen for {product}. {product_identity_lock}. {style_lock}. The product shown clean at a 3/4 angle beside one empty seal-shaped badge area left blank as a proof placeholder, with two short trust labels 「{callout_1}」 and 「{callout_2}」 in #33383D. Background pure white #FFFFFF, even clean studio light. The product occupies 30-35%, whitespace at least 40%. Negative: do NOT invent certifications, awards, ratings or test data; no fabricated badges, no watermark, no fake logo.",
            "supportsImageReference": true
          },
          {
            "shotId": "shot-08",
            "order": 8,
            "shotRole": "CTA",
            "displayName": "早晚组合优惠收口",
            "intent": "收口促单，突出组合与优惠",
            "assetType": "suite-hufugehu-jiemianru::shot-08",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "group 3/4 shot, product with a second unit beside it to suggest a set",
            "lighting": "even soft studio light, soft contact shadows",
            "background": "soft blush-beige #F6EFEA",
            "props": "none",
            "productOccupancy": "55-60% overall",
            "whitespace": ">=30%",
            "textZone": "one short CTA placeholder 「{callout_1}」 and an empty price/set badge area",
            "promptTemplate": "E-commerce closing CTA shot of {product}, a group 3/4 view with a second unit beside it to suggest a set. {product_identity_lock}. {style_lock}. Even soft studio light with soft contact shadows. Background soft blush-beige #F6EFEA. The group occupies 55-60% overall, whitespace at least 30%. A short CTA placeholder 「{callout_1}」 and an empty price/set badge area. Negative: no real discount numbers, no watermark, no fake logo, no invented claims.",
            "supportsImageReference": true
          }
        ],
        "provenance": {
          "sourceKind": "viral-reference-set",
          "sourceImageCount": 8,
          "detached": true,
          "notes": "从 8 张爆款洁面乳套图提炼；已剥离原品牌字、模特与原文案，产品一律以 {product} 占位。"
        }
      }
    },
    {
      "file": "02-instant-coffee.suite.json",
      "hash": "195099bf3b3d2d9c6f0913594afbbfb38479d7dcc379dab737fd9d5c6246296e",
      "data": {
        "schemaVersion": 1,
        "kind": "ecomgen.suite",
        "id": "suite-chongdiao-sudongheikafei",
        "name": "冻干速溶黑咖啡款",
        "description": "零糖零脂、冷水速溶的冻干黑咖啡，主打醇厚油脂与不酸涩口感，适合办公室与健身人群。",
        "category": {
          "l1": "食品饮料",
          "l2": "冲调",
          "leaf": "冻干速溶黑咖啡",
          "leafKeywords": [
            "黑咖啡",
            "速溶咖啡",
            "冻干咖啡",
            "0糖咖啡"
          ]
        },
        "productFamily": "food",
        "keywords": [
          "黑咖啡",
          "冻干速溶",
          "零糖",
          "办公室"
        ],
        "styleLock": {
          "direction": "specialty-coffee warmth with clean white anchors",
          "palette": [
            {
              "name": "clean ceramic white",
              "hex": "#FFFFFF"
            },
            {
              "name": "crema gold",
              "hex": "#C9A66B"
            },
            {
              "name": "roasted bean brown",
              "hex": "#6F4A2F"
            },
            {
              "name": "deep espresso",
              "hex": "#2B211C"
            }
          ],
          "temperature": "5200K soft daylight",
          "backgroundSystem": "white seamless for packshots, natural oak and matte ceramic for scenes",
          "lightingSystem": "soft key from upper-left at 45 degrees with gentle fill and real contact shadows",
          "surfaceSystem": "matte ceramic, natural wood, white stone",
          "typography": "Chinese sans-serif, dark cocoa on light zones",
          "presentationRules": "keep the jar and cup as the sharpest elements; steam and crema are the only motion",
          "noDrift": [
            "no neon or candy colors",
            "no glossy plastic reflections",
            "no invented certifications"
          ],
          "lockText": "Palette anchored on #FFFFFF clean ceramic with #C9A66B crema gold, #6F4A2F roasted-bean brown and #2B211C deep espresso; matte ceramic, natural wood and white stone surfaces; soft directional daylight from upper-left at 5200K with real contact shadows; keep shade and light direction identical across all shots."
        },
        "shots": [
          {
            "shotId": "hero-packshot",
            "order": 1,
            "shotRole": "HERO",
            "displayName": "白底冻干黑咖啡主图",
            "intent": "搜索页第一眼识别产品与规格",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "eye-level front view, jar centered",
            "lighting": "high-key soft key from upper-left, clean fill",
            "background": "pure #FFFFFF seamless",
            "props": "none",
            "productOccupancy": "35-40%",
            "whitespace": "at least 45%",
            "textZone": "top center 200x100 reserved, empty",
            "promptTemplate": "{product_identity_lock} Product packshot of {product} on a pure #FFFFFF seamless background, centered eye-level front view, the glass jar occupying 35-40% of the frame with generous clean whitespace. Soft high-key studio key light from the upper-left at 45 degrees with even fill and a real faint contact shadow. Sharp reflection-free glass and legible label. {style_lock} No text, no logo overlay, no props, no watermark, no extra objects.",
            "supportsImageReference": true
          },
          {
            "shotId": "hero-benefit",
            "order": 2,
            "shotRole": "HERO",
            "displayName": "冻干黑咖啡醇厚油脂卖点图",
            "intent": "一秒传达醇厚油脂与不酸涩",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "slight 3/4 high angle, jar behind a filled cup",
            "lighting": "soft key from upper-left, warm rim on the crema",
            "background": "soft white to light warm gradient",
            "props": "one white ceramic cup",
            "productOccupancy": "25-30%",
            "whitespace": "at least 45% on the copy side",
            "textZone": "left vertical band reserved, empty",
            "promptTemplate": "{product_identity_lock} Product of {product} beside a white ceramic cup filled with freshly brewed black coffee showing a rich golden crema, slight 3/4 high angle. The jar occupies 25-30% of the frame, the cup is the secondary hero. Soft key light from the upper-left reveals the crema texture and casts a natural contact shadow. Leave a clean empty vertical band on the left for a headline. {style_lock} No text, no letters, no logo, no watermark.",
            "supportsImageReference": true
          },
          {
            "shotId": "detail-granules",
            "order": 3,
            "shotRole": "DETAIL",
            "displayName": "冻干颗粒微距细节图",
            "intent": "用颗粒质感证明冻干工艺与纯咖啡身份",
            "mode": "CREATIVE",
            "aspectRatio": "4:5",
            "resolution": "2K",
            "camera": "macro top-down, shallow depth of field",
            "lighting": "raking side light to reveal granule facets",
            "background": "matte dark espresso surface",
            "props": "a small ceramic spoon",
            "productOccupancy": "40-45%",
            "whitespace": "at least 35%",
            "textZone": "bottom strip reserved, empty",
            "promptTemplate": "{product_identity_lock} Extreme macro of freeze-dried black coffee granules from {product} piled on a matte dark espresso surface with a small ceramic spoon, top-down view, shallow depth of field. Raking side light reveals crisp facets and slight sheen of the granules; authentic powder texture with no plastic look. Leave a clean empty strip at the bottom. {style_lock} No text, no logo, no watermark.",
            "supportsImageReference": true
          },
          {
            "shotId": "scene-office",
            "order": 4,
            "shotRole": "SCENE",
            "displayName": "办公室清晨提神场景图",
            "intent": "唤起工作场景中的使用联想",
            "mode": "CREATIVE",
            "aspectRatio": "4:5",
            "resolution": "2K",
            "camera": "eye-level 3/4 lifestyle framing",
            "lighting": "natural window light from the left, soft",
            "background": "bright modern desk with a laptop, plant and notebook",
            "props": "laptop, notebook, small plant",
            "productOccupancy": "20-25%",
            "whitespace": "at least 50%",
            "textZone": "upper left reserved, empty",
            "promptTemplate": "{product_identity_lock} Lifestyle scene of {product} on a bright modern desk in the morning, a filled black coffee cup beside it, a laptop, a notebook and a small plant softly out of focus. Eye-level 3/4 framing, natural window light from the left with realistic soft shadows. The product occupies 20-25% of the frame and stays the sharpest element. Props must not overlap or hide the product. Leave clean space at the upper left. {style_lock} No text, no logos, no watermark.",
            "supportsImageReference": true
          },
          {
            "shotId": "comparison-sugar",
            "order": 5,
            "shotRole": "COMPARISON",
            "displayName": "0糖对比心慌感对比图",
            "intent": "对比含糖速溶的负担感，突出0糖0脂",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "top-down split composition",
            "lighting": "even soft light, identical on both halves",
            "background": "clean white with a subtle center divider",
            "props": "a few sugar cubes on the left half",
            "productOccupancy": "35-40%",
            "whitespace": "at least 35%",
            "textZone": "top of each half reserved, empty",
            "promptTemplate": "{product_identity_lock} Top-down split comparison on a clean white surface: on one side {product} with a small pile of sugar cubes crossed out by an empty clean zone, on the other side a plain unsweetened black coffee. Identical soft lighting and framing on both halves so the only difference reads as sugar. Product occupies 35-40%. Leave clean label zones at the top of each half. {style_lock} No text, no letters, no logo, no watermark.",
            "supportsImageReference": true
          },
          {
            "shotId": "trust-origin",
            "order": 6,
            "shotRole": "TRUST",
            "displayName": "产地与冻干工艺信任图",
            "intent": "用产地与工艺细节建立品质信任",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "flat-lay top-down",
            "lighting": "even high-key soft light",
            "background": "matte warm neutral surface",
            "props": "scattered roasted coffee beans and a clean card blank",
            "productOccupancy": "30-35%",
            "whitespace": "at least 45%",
            "textZone": "right card area reserved, empty",
            "promptTemplate": "{product_identity_lock} Flat-lay trust composition of {product} on a matte warm neutral surface, surrounded by a few scattered roasted coffee beans and one blank clean card area reserved for a certificate graphic. Even high-key soft lighting, honest natural materials, no glossy plastic. The product occupies 30-35% and stays the sharpest subject. Leave the right side clean and empty. {style_lock} No text, no logo, no watermark, do not invent certifications or awards.",
            "supportsImageReference": true
          },
          {
            "shotId": "cta-promo",
            "order": 7,
            "shotRole": "CTA",
            "displayName": "囤货促销行动图",
            "intent": "用组合陈列与促销区促成加购",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "slight low angle hero grouping",
            "lighting": "bright soft key with warm accent",
            "background": "clean white with a warm accent band",
            "props": "two additional jars arranged as a bundle",
            "productOccupancy": "40-45%",
            "whitespace": "at least 40%",
            "textZone": "top banner and bottom banner reserved, empty",
            "promptTemplate": "{product_identity_lock} Promotional grouping of {product} shown as a multi-jar bundle on a clean white surface with a warm #C9A66B accent band, slight low-angle hero framing. Bright soft key light with a subtle warm accent and real contact shadows. Products occupy 40-45% and stay sharply separated. Leave clean empty banner zones at the top and bottom for offer copy. {style_lock} No text, no numbers, no logo, no watermark.",
            "supportsImageReference": true
          }
        ],
        "provenance": {
          "sourceKind": "viral-reference-set",
          "sourceImageCount": 7,
          "detached": true,
          "notes": "由爆款套图吸取视觉语法后重写，已脱离原图商品与文案。"
        }
      }
    },
    {
      "file": "03-daily-nuts.suite.json",
      "hash": "5dd548d32a365d7ab6fe273c7541769a5bdb442ec572348bda07e3d8bc618d68",
      "data": {
        "schemaVersion": 1,
        "kind": "ecomgen.suite",
        "id": "suite-xiuxianlingshi-meirijianhao",
        "name": "每日混合坚果独立装款",
        "description": "七种坚果果干的每日 30g 独立小包，主打新鲜锁鲜与无添加，适合办公加餐与儿童零食。",
        "category": {
          "l1": "食品饮料",
          "l2": "休闲零食",
          "leaf": "每日混合坚果",
          "leafKeywords": [
            "每日坚果",
            "混合坚果",
            "独立装",
            "健康零食"
          ]
        },
        "productFamily": "food",
        "keywords": [
          "每日坚果",
          "混合坚果",
          "独立包装",
          "无添加"
        ],
        "styleLock": {
          "direction": "fresh natural snack brightness with warm nut tones",
          "palette": [
            {
              "name": "clean paper white",
              "hex": "#FFFFFF"
            },
            {
              "name": "nut brown",
              "hex": "#8C5A2B"
            },
            {
              "name": "honey gold",
              "hex": "#E8C27A"
            },
            {
              "name": "fresh leaf green",
              "hex": "#3B7A57"
            }
          ],
          "temperature": "5400K clean daylight",
          "backgroundSystem": "white paper for packshots, light oak and linen for lifestyle",
          "lightingSystem": "soft top-left key with gentle fill and crisp natural contact shadows",
          "surfaceSystem": "white paper, light oak, natural linen",
          "typography": "Chinese sans-serif, warm brown on light zones",
          "presentationRules": "keep nuts glossy-but-natural, never oily or plastic; green accent used sparingly",
          "noDrift": [
            "no artificial candy colors",
            "no greasy sheen",
            "no invented health claims"
          ],
          "lockText": "Palette anchored on #FFFFFF clean paper with #8C5A2B nut brown, #E8C27A honey gold and a sparing #3B7A57 fresh green; white paper, light oak and natural linen surfaces; soft top-left daylight key at 5400K with natural crisp contact shadows; keep shade and light direction identical across all shots."
        },
        "shots": [
          {
            "shotId": "hero-packshot",
            "order": 1,
            "shotRole": "HERO",
            "displayName": "白底每日坚果主图",
            "intent": "搜索页第一眼识别产品与独立装形态",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "eye-level slight 3/4, pouch standing",
            "lighting": "high-key soft key from upper-left, even fill",
            "background": "pure #FFFFFF seamless",
            "props": "none",
            "productOccupancy": "35-40%",
            "whitespace": "at least 45%",
            "textZone": "top center reserved, empty",
            "promptTemplate": "{product_identity_lock} Product packshot of {product}, a stand-up pouch centered on a pure #FFFFFF seamless background, eye-level slight 3/4 view. The pouch occupies 35-40% of the frame with generous clean whitespace and a faint real contact shadow. Soft high-key key light from the upper-left at 45 degrees with even fill; matte film with legible label and no glare. {style_lock} No text, no logo overlay, no props, no watermark.",
            "supportsImageReference": true
          },
          {
            "shotId": "hero-daily-pack",
            "order": 2,
            "shotRole": "HERO",
            "displayName": "每日30g独立小包卖点图",
            "intent": "强调每天一包的定量与新鲜锁鲜",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "top-down flat lay of pouch and opened daily pack",
            "lighting": "soft even key from the upper-left",
            "background": "clean white paper",
            "props": "one opened small pack spilling a few nuts",
            "productOccupancy": "30-35%",
            "whitespace": "at least 45%",
            "textZone": "left vertical band reserved, empty",
            "promptTemplate": "{product_identity_lock} Top-down flat lay of {product}: the main pouch beside one opened 30g single-serve pack with a few nuts and dried fruit spilling out naturally on clean white paper. Soft even key light from the upper-left with real contact shadows; nuts look fresh with natural texture, not oily. Product and pack occupy 30-35%. Leave a clean empty vertical band on the left. {style_lock} No text, no letters, no logo, no watermark.",
            "supportsImageReference": true
          },
          {
            "shotId": "detail-macro",
            "order": 3,
            "shotRole": "DETAIL",
            "displayName": "坚果果干微距细节图",
            "intent": "用颗粒与果干质感证明真材实料",
            "mode": "CREATIVE",
            "aspectRatio": "4:5",
            "resolution": "2K",
            "camera": "macro top-down, shallow depth of field",
            "lighting": "raking side light to reveal texture",
            "background": "matte light oak",
            "props": "a few whole almonds, walnuts and cranberries",
            "productOccupancy": "40-45%",
            "whitespace": "at least 35%",
            "textZone": "bottom strip reserved, empty",
            "promptTemplate": "{product_identity_lock} Extreme macro of a mix of whole almonds, walnut halves and dried cranberries from {product} arranged on a matte light oak surface, top-down, shallow depth of field. Raking side light reveals natural ridges, skins and fruit texture; honest matte look with no oil or syrup sheen. Leave a clean empty strip at the bottom. {style_lock} No text, no logo, no watermark.",
            "supportsImageReference": true
          },
          {
            "shotId": "scene-desk",
            "order": 4,
            "shotRole": "SCENE",
            "displayName": "办公加餐场景图",
            "intent": "唤醒午后加餐的使用场景",
            "mode": "CREATIVE",
            "aspectRatio": "4:5",
            "resolution": "2K",
            "camera": "eye-level 3/4 lifestyle framing",
            "lighting": "natural window light from the left",
            "background": "bright desk with a notebook, mug and small plant",
            "props": "notebook, mug, small plant",
            "productOccupancy": "20-25%",
            "whitespace": "at least 50%",
            "textZone": "upper left reserved, empty",
            "promptTemplate": "{product_identity_lock} Lifestyle scene of {product} on a bright desk during an afternoon break, the pouch and one opened pack beside a notebook, a mug and a small plant softly out of focus. Eye-level 3/4 framing, natural window light from the left with realistic soft shadows. Product occupies 20-25% and stays the sharpest element; props must not cover it. Leave clean space at the upper left. {style_lock} No text, no logos, no watermark.",
            "supportsImageReference": true
          },
          {
            "shotId": "comparison-snack",
            "order": 5,
            "shotRole": "COMPARISON",
            "displayName": "对比油炸零食健康图",
            "intent": "对比油炸膨化零食突出轻负担",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "top-down split composition",
            "lighting": "even soft light identical on both halves",
            "background": "clean white with a subtle center divider",
            "props": "a small pile of fried chips on the left half",
            "productOccupancy": "35-40%",
            "whitespace": "at least 35%",
            "textZone": "top of each half reserved, empty",
            "promptTemplate": "{product_identity_lock} Top-down split comparison on clean white: on one side {product} with nuts and dried fruit, on the other side a small pile of fried chips. Identical soft lighting and framing so the difference reads as baked-nuts versus fried-snack. Product occupies 35-40%. Leave clean label zones at the top of each half. {style_lock} No text, no letters, no logo, no watermark.",
            "supportsImageReference": true
          },
          {
            "shotId": "trust-origin",
            "order": 6,
            "shotRole": "TRUST",
            "displayName": "原料新鲜无添加信任图",
            "intent": "用散料与洁净陈列建立新鲜与无添加信任",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "flat-lay top-down",
            "lighting": "even high-key soft light",
            "background": "natural linen on light oak",
            "props": "scattered raw nuts and a blank clean card",
            "productOccupancy": "30-35%",
            "whitespace": "at least 45%",
            "textZone": "right card area reserved, empty",
            "promptTemplate": "{product_identity_lock} Flat-lay trust composition of {product} on natural linen over light oak, surrounded by a few scattered raw nuts and one blank clean card area reserved for a fact graphic. Even high-key soft lighting, honest natural materials. Product occupies 30-35% and stays the sharpest subject. Leave the right side clean and empty. {style_lock} No text, no logo, no watermark, do not invent certifications or health claims.",
            "supportsImageReference": true
          },
          {
            "shotId": "cta-bundle",
            "order": 7,
            "shotRole": "CTA",
            "displayName": "大包装囤货行动图",
            "intent": "用多袋组合与促销区促成加购",
            "mode": "CREATIVE",
            "aspectRatio": "1:1",
            "resolution": "2K",
            "camera": "slight low angle hero grouping",
            "lighting": "bright soft key with a warm accent",
            "background": "clean white with a #3B7A57 accent band",
            "props": "three pouches arranged as a bundle",
            "productOccupancy": "40-45%",
            "whitespace": "at least 40%",
            "textZone": "top and bottom banner reserved, empty",
            "promptTemplate": "{product_identity_lock} Promotional grouping of {product} shown as a three-pouch bundle on a clean white surface with a thin #3B7A57 accent band, slight low-angle hero framing. Bright soft key light with a subtle warm accent and real contact shadows. Pouches occupy 40-45% and stay sharply separated. Leave clean empty banner zones at the top and bottom for offer copy. {style_lock} No text, no numbers, no logo, no watermark.",
            "supportsImageReference": true
          }
        ],
        "provenance": {
          "sourceKind": "viral-reference-set",
          "sourceImageCount": 7,
          "detached": true,
          "notes": "由爆款套图吸取视觉语法后重写，已脱离原图商品与文案。"
        }
      }
    }
  ]
};
