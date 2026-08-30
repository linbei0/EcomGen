// 自动生成文件：由 scripts/generate-manifest.mjs 从 src/templates/ 生成，请勿手改。
// 重新生成：pnpm --filter @ecomgen/ecom-skill gen:templates
export default {
  "totalHash": "dcb41727f7eba2dacf4ab4daced69699f34e5d92e84a52679ad8d199b000917d",
  "templates": [
    {
      "file": "01-hero-image.json",
      "hash": "d7850f61fefd57cd254e57a6a91c405d3146d86e3336bbd2aa47e49dd1c8e6a7",
      "upstreamNumber": 1,
      "data": {
        "id": "hero-image",
        "name": "白底/纯色底产品主图",
        "keywords": [
          "白底图",
          "主图",
          "hero image",
          "白背景",
          "product shot",
          "packshot",
          "产品照",
          "商品主图"
        ],
        "trigger_phrases": [
          "产品主图",
          "白底图",
          "白背景产品",
          "hero image",
          "电商主图",
          "纯色背景"
        ],
        "prompt_template": {
          "type": "product photography",
          "subject": "{product_description}",
          "background": "clean white background",
          "lighting": "soft diffused studio lighting, even illumination",
          "composition": "centered, front view",
          "quality": "8K, commercial e-commerce photography"
        },
        "defaults": {
          "background": "clean white background",
          "lighting": "soft diffused studio lighting",
          "composition": "centered, front view"
        },
        "variants": {
          "luxury": {
            "description": "高端奢侈品风格",
            "overrides": {
              "lighting": "Rembrandt lighting, subtle rim light",
              "background": "gradient from dark to light, premium feel"
            }
          },
          "fresh": {
            "description": "清新自然风格",
            "overrides": {
              "lighting": "bright natural light",
              "background": "light pastel tones"
            }
          },
          "tech": {
            "description": "科技感风格",
            "overrides": {
              "lighting": "dramatic side lighting",
              "background": "dark minimalist"
            }
          },
          "color": {
            "description": "彩色背景风格",
            "overrides": {
              "background": "{color} gradient background"
            }
          }
        },
        "category_tips": {
          "beauty": "emphasize texture and glow, show formula details",
          "electronics": "highlight metallic finish, screen details, port precision",
          "food": "vibrant colors, fresh appearance, show texture",
          "fashion": "show fabric texture, drape quality, stitching details",
          "home": "show material quality, craftsmanship, lifestyle appeal",
          "jewelry": "macro detail, sparkle and cut quality, luxurious lighting"
        },
        "examples": [
          "{product}, professional product photography on clean white background, soft diffused studio lighting, centered, 8K, commercial e-commerce photography, no shadows, no props",
          "{product} on pure white seamless background, bright commercial studio lighting, centered, 3/4 profile, high resolution, marketplace ready, {material_description}",
          "{product} floating slightly above white surface, softbox overhead, sharp rim light on edges, professional packshot, 8K, ultra-detailed textures"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "02-lifestyle-scene.json",
      "hash": "3884056b36b4bd8dd11eb32ee33e634f3f6258ad8bf9f6bf1e6d8f63a00d417e",
      "upstreamNumber": 2,
      "data": {
        "id": "lifestyle-scene",
        "name": "场景化生活图",
        "keywords": [
          "场景图",
          "生活图",
          "lifestyle",
          "使用场景",
          "生活场景",
          "场景化",
          "lifestyle photography"
        ],
        "trigger_phrases": [
          "场景图",
          "生活图",
          "使用场景图",
          "lifestyle photo",
          "产品场景",
          "生活化展示"
        ],
        "prompt_template": {
          "type": "lifestyle product photography",
          "subject": "{product_description}",
          "setting": "{scene_description}",
          "lighting": "natural {time_of_day} light",
          "composition": "{composition_style}",
          "mood": "{mood_description}",
          "quality": "8K, editorial lifestyle photography"
        },
        "defaults": {
          "setting": "modern living space, clean and organized",
          "lighting": "natural morning light through window",
          "composition": "rule of thirds, product as focal point",
          "mood": "warm and inviting"
        },
        "variants": {
          "morning": {
            "description": "早晨清新氛围",
            "overrides": {
              "setting": "bright room with sunlight streaming through window",
              "lighting": "soft morning golden light, visible dust particles",
              "mood": "fresh, clean, new beginning"
            }
          },
          "cozy": {
            "description": "温馨舒适氛围",
            "overrides": {
              "setting": "warm cozy interior, soft textiles, candles",
              "lighting": "warm ambient lighting, soft golden tones",
              "mood": "comfortable, intimate"
            }
          },
          "outdoor": {
            "description": "户外自然场景",
            "overrides": {
              "setting": "outdoor natural setting, organic elements",
              "lighting": "golden hour natural sunlight",
              "mood": "natural, free, adventurous"
            }
          },
          "luxury": {
            "description": "奢华高端场景",
            "overrides": {
              "setting": "luxury spa/hotel, marble and gold fixtures",
              "lighting": "cinematic lighting, warm color grading",
              "mood": "premium, sophisticated"
            }
          }
        },
        "category_tips": {
          "beauty": "bathroom vanity with botanical elements, skincare ritual feel",
          "electronics": "modern desk setup, minimal aesthetic, tech-forward",
          "food": "kitchen counter or dining table, fresh ingredients, warm tones",
          "fashion": "urban street or boutique fitting room, model wearing the item",
          "home": "styled room interior, product naturally placed"
        },
        "examples": [
          "{product} naturally placed in {scene}, morning sunlight through window, botanical touches, warm atmosphere, professional lifestyle photography, 8K",
          "Cinematic luxury interior with marble walls and gold fixtures. {product} prominently displayed. Morning sunlight through frosted glass. Fresh flowers. Cinematic depth of field, warm color grading, 8K",
          "{product} in cozy setting, warm ambient lighting, soft textiles, golden hour tones, lifestyle photography, authentic atmosphere"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "03-flat-lay.json",
      "hash": "7576403ef9a82bc323afd10aea9ddb3a1c7dacf4f93077950082eec115a99457",
      "upstreamNumber": 3,
      "data": {
        "id": "flat-lay",
        "name": "平铺图",
        "keywords": [
          "平铺图",
          "flat lay",
          "俯拍",
          "top-down",
          "flatlay",
          "俯视图"
        ],
        "trigger_phrases": [
          "平铺图",
          "flat lay",
          "俯拍",
          "top-down view",
          "产品平铺"
        ],
        "prompt_template": {
          "type": "flat lay photography, top-down view",
          "subject": "{product_description} as hero at bottom center",
          "props": "{prop_list}",
          "background": "{background_material}",
          "color_palette": "{color_scheme}",
          "lighting": "soft natural window light from top-left at 45 degrees",
          "quality": "8K, editorial photography, no text, no watermark"
        },
        "defaults": {
          "props": "carefully curated complementary objects",
          "background": "ivory linen texture",
          "color_palette": "ivory, blush, champagne gold, sage green"
        },
        "variants": {
          "luxury": {
            "description": "奢华仪式感",
            "overrides": {
              "props": "gold foil flakes, pearl beads, dried flowers, silk ribbon, leather journal",
              "background": "ivory linen with subtle shadow from sheer curtains",
              "color_palette": "ivory, blush pink, champagne gold, soft cream"
            }
          },
          "minimal": {
            "description": "极简风格",
            "overrides": {
              "props": "only 2-3 essential items, clean lines",
              "background": "clean white surface",
              "color_palette": "white, gray, one accent color"
            }
          },
          "seasonal": {
            "description": "季节主题",
            "overrides": {
              "props": "seasonal elements matching theme",
              "color_palette": "season-appropriate color scheme"
            }
          }
        },
        "category_tips": {
          "beauty": "skincare ritual flat lay, open product showing formula, botanical elements",
          "food": "ingredients spread, fresh produce, kitchen tools",
          "fashion": "clothing + accessories + shoes arranged aesthetically, fabric textures",
          "home": "decor items, textures, materials spread showing lifestyle"
        },
        "examples": [
          "Luxurious {category} ritual flat lay, top-down photography. {product} with lid open showing texture as hero at bottom center. Surrounding: gold-tone palette, crystal bottle, dried lavender with silk ribbon, gold foil flakes, pearl beads. Background: ivory linen. Color: ivory, blush, champagne gold. Soft window light top-left at 45 degrees. 8K, no text, no watermark",
          "{product} flat lay top-down as hero. Surrounding: {props}. {background} background. Color: {colors}. Soft window light top-left. Clean aesthetic, 8K",
          "Professional {category} flat lay, top-down editorial. {product} centered with curated objects. {background} background. Strict color control. 8K, magazine quality, no text"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "04-detail-macro.json",
      "hash": "a3121a0430262a1c4b5bf9ea03179c588255212948f498c15124b371204140b9",
      "upstreamNumber": 4,
      "data": {
        "id": "detail-macro",
        "name": "细节微距图",
        "keywords": [
          "细节图",
          "微距",
          "macro",
          "特写",
          "close-up",
          "detail shot",
          "细节展示"
        ],
        "trigger_phrases": [
          "细节图",
          "微距图",
          "产品特写",
          "材质特写",
          "detail shot",
          "macro photography"
        ],
        "prompt_template": {
          "type": "macro product photography",
          "subject": "{product_description}, extreme close-up on {focus_area}",
          "detail": "visible {texture_description}",
          "lighting": "{lighting_style}",
          "camera": "shot with {camera_setup}",
          "quality": "ultra macro detail, 8K, professional product photography"
        },
        "defaults": {
          "focus_area": "texture and material quality",
          "detail": "fine texture, material grain, surface quality",
          "lighting": "soft directional lighting highlighting texture",
          "camera": "dedicated macro lens setup"
        },
        "variants": {
          "texture": {
            "description": "材质纹理展示",
            "overrides": {
              "focus_area": "material surface showing grain and quality"
            }
          },
          "formula": {
            "description": "产品配方展示",
            "overrides": {
              "focus_area": "product formula showing cream/liquid texture",
              "detail": "formula consistency, light reflection"
            }
          },
          "craftsmanship": {
            "description": "工艺细节展示",
            "overrides": {
              "focus_area": "stitching, joints, edges, manufacturing precision"
            }
          }
        },
        "category_tips": {
          "beauty": "show cream formula texture, shimmer particles, light reflection",
          "electronics": "show port precision, material finish, button detail",
          "food": "show ingredient texture, cross-section, freshness",
          "fashion": "show fabric weave, stitching quality, hardware detail",
          "jewelry": "show gemstone cut, metal finish, clasp detail"
        },
        "examples": [
          "Extreme close-up beauty macro, Canon EOS R5 100mm f/2.8 macro. {product} filling 80% of frame, focusing on {focus_area}. Visible pores, fine lines, natural imperfections, NOT retouched. Formula visible with realistic light reflection. Natural side lighting. 8K",
          "Cinematic {category} close-up. {product} detail showing {texture_description}. Formula/texture visible between fingertips with subtle light reflection. Soft blur background. Dramatic side lighting, warm tones, 8K",
          "Macro detail of {product}, Sony A7R V 90mm macro, focus stacking. Extreme detail showing {focus_area}. Professional product photography, 8K"
        ],
        "anti_ai_tips": "For hand shots: specify real skin (visible knuckle lines, slight dryness on cuticles, natural warm tone). NOT retouched or smoothed.",
        "supports_image_reference": true
      }
    },
    {
      "file": "05-poster-banner.json",
      "hash": "ea3012598cd55670710d4ea2b72ba678b92c6aa7842bad77ff4835656ec6e78a",
      "upstreamNumber": 5,
      "data": {
        "id": "poster-banner",
        "name": "促销海报/Banner",
        "keywords": [
          "海报",
          "poster",
          "banner",
          "促销",
          "广告图",
          "活动图",
          "promotion",
          "sale"
        ],
        "trigger_phrases": [
          "促销海报",
          "banner",
          "广告图",
          "活动海报",
          "促销图",
          "campaign poster",
          "sale banner"
        ],
        "prompt_template": {
          "type": "promotional poster design",
          "subject": "{product_description}",
          "background": "{background_description}",
          "headline": "{headline_text}",
          "subtitle": "{subtitle_text}",
          "price": "{price_info}",
          "cta": "{cta_text}",
          "style": "{visual_style}",
          "quality": "high-resolution professional marketing design"
        },
        "defaults": {
          "background": "gradient matching brand aesthetic",
          "headline": "headline text",
          "subtitle": "subtitle or description",
          "price": "",
          "cta": "Shop Now",
          "style": "clean minimalist with accent colors"
        },
        "variants": {
          "luxury": {
            "description": "高端奢华风格",
            "overrides": {
              "background": "full-bleed rich gradient, gold accents",
              "style": "luxury magazine editorial, gold foil, pearl embellishments"
            }
          },
          "minimal": {
            "description": "极简现代风格",
            "overrides": {
              "background": "clean white or light gradient",
              "style": "minimalist modern typography, generous white space"
            }
          },
          "festive": {
            "description": "节日主题风格",
            "overrides": {
              "background": "festive themed gradient with decorative elements",
              "style": "festive, cultural elements, seasonal motifs"
            }
          },
          "flash-sale": {
            "description": "限时折扣风格",
            "overrides": {
              "style": "bold attention-grabbing, high contrast, urgency elements"
            }
          }
        },
        "category_tips": {
          "beauty": "rose gold accents, elegant serif fonts, luxury gift aesthetic",
          "electronics": "dark backgrounds, neon accents, futuristic typography",
          "food": "warm colors, dynamic food elements, freshness cues",
          "fashion": "editorial style, model inclusion, aspirational lifestyle"
        },
        "examples": [
          "Luxury {category} campaign poster. Full-bleed gradient ivory to rose. Top: {headline} elegant serif. Center: {product} with decorative elements. {subtitle}. Bottom left: price {price} original crossed out. Bottom right: brand logo and {cta}. Gold foil accents, premium aesthetic, 2000x3000px",
          "{category} promotional poster. {product} centered on {background}. Bold {headline} at top, price {price}, {cta} button. Clean minimalist, accent colors, professional layout, 2000x2000px",
          "Holiday {category} gift campaign. {background} with decorative elements. Center: {product} with gift wrapping. Headline {headline} modern script. Price tag {price} decorative frame. Festive sophisticated, warm cinematic lighting, 1080x1350px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "06-social-media.json",
      "hash": "e2a3aad6036ada0f251730ff1e5a87212c7e041693dad5ba2d5d4be9f53a2209",
      "upstreamNumber": 6,
      "data": {
        "id": "social-media",
        "name": "社交媒体素材",
        "keywords": [
          "社交媒体",
          "小红书",
          "instagram",
          "tiktok",
          "种草",
          "社媒",
          "social media"
        ],
        "trigger_phrases": [
          "社交媒体图",
          "小红书图",
          "Instagram",
          "TikTok",
          "种草图",
          "社媒素材",
          "social media post"
        ],
        "prompt_template": {
          "type": "social media content",
          "subject": "{product_description}",
          "platform": "{platform_style}",
          "composition": "phone camera perspective, slightly off-center",
          "lighting": "natural indoor lighting",
          "overlay": "{overlay_elements}",
          "quality": "authentic smartphone photography aesthetic"
        },
        "defaults": {
          "platform": "Instagram post style",
          "composition": "casual phone framing, slightly imperfect",
          "lighting": "natural window light, warm color tone",
          "overlay": "minimal stickers and text badges"
        },
        "variants": {
          "xiaohongshu": {
            "description": "小红书种草风格",
            "overrides": {
              "platform": "Xiaohongshu RED app lifestyle photo, iPhone shot",
              "composition": "slightly tilted like quick grab shot",
              "lighting": "iPhone warm auto-white-balance, Kodak Portra 400 color feel",
              "overlay": "Xiaohongshu sticker, casual text, star rating"
            }
          },
          "instagram": {
            "description": "Instagram帖子风格",
            "overrides": {
              "platform": "Instagram post premium aesthetic",
              "composition": "clean framing with visual hierarchy",
              "overlay": "engagement badges, hashtag elements"
            }
          },
          "tiktok": {
            "description": "TikTok/Reels封面风格",
            "overrides": {
              "platform": "TikTok/Reels thumbnail, vertical format",
              "overlay": "trending audio icon, duet prompt, engagement metrics"
            }
          }
        },
        "category_tips": {
          "beauty": "show product in use on skin, texture close-up, real results",
          "food": "overhead dish/drink shot, appetizing colors, 45-degree angle",
          "fashion": "mirror selfie or outfit grid, casual styling, real-person aesthetic",
          "home": "corner shot in styled room, cozy atmosphere, warm tones"
        },
        "examples": [
          "Ultra-realistic Xiaohongshu RED product lifestyle photo, iPhone 15 Pro, NOT professional photographer. Slightly tilted angle, {product} on {surface}, lid off showing texture. Environmental details: slight water stain, natural shadows, lived-in feel. iPhone warm auto-white-balance, natural noise, NOT sharpened, Kodak Portra 400 feel, NOT AI-generated look, 8K, 1080x1350px",
          "Instagram post format. {product} with overlay text, clean aesthetic. Feature cards showing benefits. Engagement icons. Hashtag tags. Square format, lifestyle aesthetic, 1080x1080px",
          "Premium social media content, TikTok thumbnail. {product} in lifestyle setting. Timestamp badge, engagement metrics, product card. Trending audio icon. Color gradient frame. Viral-worthy composition, 1080x1920px"
        ],
        "anti_ai_tips": "Specify phone model. Add imperfection: noise, warm cast, not centered, slight blur. Use 'NOT AI-generated look'. Reference Kodak Portra 400 tone. Show lived-in environment.",
        "supports_image_reference": true
      }
    },
    {
      "file": "07-ugc-style.json",
      "hash": "ae46fa51c70bc95cbb66a01da3f3154c4109f69f96a025b574846642cb9e901f",
      "upstreamNumber": 7,
      "data": {
        "id": "ugc-style",
        "name": "UGC风格/买家秀",
        "keywords": [
          "UGC",
          "买家秀",
          "用户生成",
          "真实用户",
          "user generated",
          "GRWM",
          "真实感"
        ],
        "trigger_phrases": [
          "UGC图",
          "买家秀",
          "用户图",
          "真实买家",
          "GRWM",
          "user-generated",
          "真实分享"
        ],
        "prompt_template": {
          "type": "authentic UGC snapshot",
          "subject": "{product_description}",
          "style": "smartphone front camera selfie, casual snapshot, NOT professional photography",
          "environment": "real lived-in space, slightly messy, NOT styled",
          "lighting": "indoor lighting with warm yellow cast, uneven",
          "imperfection": "visible noise/grain, imperfect framing, off-center, slightly tilted",
          "quality": "raw phone photo with natural imperfections, NOT AI-generated look, NOT studio quality"
        },
        "defaults": {
          "style": "iPhone front camera, candid snapshot",
          "environment": "real bathroom or bedroom, lived-in details",
          "lighting": "warm indoor overhead lighting, slight yellow cast",
          "imperfection": "noise in shadows, not oversharpened, slight highlight overexposure"
        },
        "variants": {
          "mirror-selfie": {
            "description": "浴室镜自拍",
            "overrides": {
              "style": "iPhone front camera mirror selfie",
              "environment": "bathroom mirror, slight condensation and fog marks",
              "imperfection": "phone case at edge, finger smudge on mirror"
            }
          },
          "ccd-retro": {
            "description": "CCD复古胶片感",
            "overrides": {
              "style": "vintage 2005 CCD digicam photo, direct flash, cheap camera aesthetic",
              "lighting": "harsh direct on-camera flash, strong warm yellow-green color shift, blown-out highlights",
              "imperfection": "heavy film grain, overexposed skin on forehead and nose, flash hotspot, chromatic aberration at edges, red date stamp bottom-right corner"
            }
          },
          "grwm": {
            "description": "GRWM跟我一起准备",
            "overrides": {
              "style": "Get Ready With Me video thumbnail, morning routine",
              "environment": "vanity mirror, slightly messy counter"
            }
          },
          "unboxing": {
            "description": "开箱分享",
            "overrides": {
              "style": "casual unboxing photo on bed or desk",
              "environment": "bed with wrinkled sheets or cluttered desk"
            }
          }
        },
        "category_tips": {
          "beauty": "product in use on real skin, visible pores, bathroom setting",
          "food": "phone snap on table, casual restaurant or home",
          "fashion": "mirror selfie wearing item, bedroom or fitting room",
          "electronics": "desk setup with product in use, realistic cables",
          "home": "product in actual living space, not perfectly styled"
        },
        "examples": [
          "Bathroom mirror selfie, iPhone front camera. Person with {product}. Mirror has slight condensation. Warm yellowish indoor lighting. {product} label recognizable but not centered. Skin: visible pores, slight redness, NOT flawless. Warm yellow cast, phone noise, natural unposed, NOT AI-generated look, authentic UGC, 1080x1350px",
          "Vintage 2005 CCD digicam photo, harsh direct flash. Heavy film grain, blown-out highlights on face, strong yellow-green color cast, chromatic aberration at edges. Person holding {product} with casual peace sign. Genuine candid expression. Dim bedroom with string lights, unmade bed. Off-center, slightly tilted composition. Red date stamp '06.12.25' in bottom-right corner. Low resolution, NOT sharp, NOT AI-generated look, raw snapshot, 1080x1350px",
          "Authentic GRWM photo. Person in casual setting showing {product}. Natural imperfect lighting, slightly messy background. Phone selfie angle. Genuine expression. Warm tones, candid smartphone photography, NOT AI-generated look, 1080x1620px"
        ],
        "anti_ai_tips": "CRITICAL: (1) Specify phone model (iPhone 14 Pro/15), (2) Add imperfection (pores, noise, warm cast, off-center), (3) Candid language (NOT professional), (4) Real environment (slightly messy), (5) Avoid AI words (no perfect, flawless, stunning), (6) State 'NOT AI-generated look', (7) Reference Kodak Portra 400 tone",
        "supports_image_reference": true
      }
    },
    {
      "file": "08-model-showcase.json",
      "hash": "a1697c690151bf9095437e618c8077d727eecc1eecddcf29ae6aa8c9c62ff677",
      "upstreamNumber": 8,
      "data": {
        "id": "model-showcase",
        "name": "模特展示图",
        "keywords": [
          "模特",
          "model",
          "人物展示",
          "模特图",
          "真人展示",
          "人物图"
        ],
        "trigger_phrases": [
          "模特图",
          "真人展示",
          "人物图",
          "model photo",
          "模特展示",
          "人物展示图"
        ],
        "prompt_template": {
          "type": "editorial beauty/fashion photography",
          "subject": "{person_description} with {product_description}",
          "camera": "shot with {camera_setup}",
          "lighting": "natural window light creating realistic highlights",
          "skin_detail": "visible pores, natural skin texture, NOT retouched",
          "expression": "{expression_description}",
          "quality": "professional editorial photography, 8K"
        },
        "defaults": {
          "camera": "Canon EOS R5, 85mm f/1.4 lens",
          "lighting": "natural window light from left, realistic highlights",
          "skin_detail": "visible pores, natural under-eye shadows, slight texture unevenness",
          "expression": "authentic relaxed, subtle natural asymmetry"
        },
        "variants": {
          "beauty-closeup": {
            "description": "美妆极致特写",
            "overrides": {
              "camera": "Canon EOS R5, 100mm f/2.8 macro",
              "skin_detail": "incredibly detailed: pores, fine lines, freckles, NOT retouched",
              "expression": "eyes half-closed, peaceful self-care moment"
            }
          },
          "fashion-full": {
            "description": "时尚全身展示",
            "overrides": {
              "camera": "Canon EOS R5, 50mm f/1.2",
              "expression": "confident direct gaze, editorial pose"
            }
          },
          "candid": {
            "description": "自然抓拍",
            "overrides": {
              "camera": "iPhone 15 Pro main camera",
              "expression": "genuine candid, mid-action",
              "skin_detail": "natural texture, slight blemishes, relatable"
            }
          }
        },
        "category_tips": {
          "beauty": "extreme close-up on application moment, formula texture on skin, real skin mandatory",
          "fashion": "full outfit showcase, pose highlighting garment, editorial lighting",
          "accessories": "product being worn/used, hand or body detail, lifestyle context",
          "sports": "active pose in appropriate setting, show performance"
        },
        "examples": [
          "Extreme close-up beauty macro, Canon EOS R5 100mm f/2.8 macro. Face filling 80% of frame, {product} being applied on {focus_area}. Skin incredibly detailed: pores, fine lines, natural imperfections, NOT retouched. Formula visible with realistic reflection. Natural side lighting. NOT AI-generated look, 8K, 1080x1350px",
          "Fashion editorial. {person} with {product}, Canon EOS R5 85mm f/1.4. Natural window light, visible pores, natural shadows, authentic expression, soft bokeh, warm golden tones, 1080x1350px",
          "Candid beauty moment. {person} with {product}, iPhone front camera. Natural lighting, visible pores and texture, relaxed candid, NOT AI-generated look, documentary style, 1080x1350px"
        ],
        "anti_ai_tips": "MANDATORY: (1) Real camera (Canon EOS R5 / Sony A7 IV), (2) Visible skin imperfections (pores, uneven tone, blemishes, fine lines), (3) Natural expression asymmetry, (4) 'NOT retouched, NOT AI-generated look', (5) Real lighting (natural window, NOT studio-perfect), (6) Natural hand details (knuckle lines, cuticle texture)",
        "supports_image_reference": true
      }
    },
    {
      "file": "09-before-after.json",
      "hash": "37f7ea3695d57ea30d6fbcb396e732973336d97417675dc62ee2bd4c5a883ead",
      "upstreamNumber": 9,
      "data": {
        "id": "before-after",
        "name": "使用前后对比图",
        "keywords": [
          "对比",
          "before after",
          "前后",
          "效果对比",
          "transformation",
          "变化图"
        ],
        "trigger_phrases": [
          "对比图",
          "前后对比",
          "before after",
          "效果展示",
          "使用效果",
          "transformation"
        ],
        "prompt_template": {
          "type": "before/after comparison visualization",
          "subject": "{product_description}",
          "before_state": "{before_description}",
          "after_state": "{after_description}",
          "metrics": "{data_points}",
          "divider": "elegant center divider",
          "quality": "professional campaign photography"
        },
        "defaults": {
          "before_state": "dull, dry, uneven appearance",
          "after_state": "radiant, smooth, healthy appearance",
          "metrics": "improvement percentage",
          "divider": "elegant gold line with arrow"
        },
        "variants": {
          "clinical": {
            "description": "临床数据风格",
            "overrides": {
              "metrics": "detailed data grid with 4+ metrics and percentage arrows"
            }
          },
          "cinematic": {
            "description": "电影感蜕变",
            "overrides": {
              "before_state": "moody dramatic, cool tone",
              "after_state": "bright warm golden hour, warm tone",
              "divider": "decorative vintage frame with product"
            }
          },
          "simple": {
            "description": "简洁信息图",
            "overrides": {
              "metrics": "simple progress bar with key metric"
            }
          }
        },
        "category_tips": {
          "beauty": "show skin texture change, include moisture/radiance percentage data",
          "fitness": "body transformation, consistent pose and lighting",
          "home": "room before/after renovation or cleaning",
          "automotive": "vehicle before/after detailing"
        },
        "examples": [
          "Cinematic before/after {category} transformation. Left: moody lighting showing {before}, cool tone. Right: bright golden hour showing {after}, warm tone. Center: decorative frame with product. Bottom: comparison data grid. Premium campaign layout, 8K, 1080x1620px",
          "Premium before/after comparison. Left: {before_state}, caption 'Before'. Right: {after_state}, caption 'After'. Gold divider with arrow. Bottom: progress metrics {data}. Product thumbnail. Clean clinical aesthetic, 1080x1080px",
          "{category} comparison visualization. Split: {before_state} left, {after_state} right. Key metrics below. White background, professional style, 1080x1080px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "10-packaging.json",
      "hash": "17a11fadc25921e2806943a94b083955b0a6ffa767fcf66cc1577724b24867dc",
      "upstreamNumber": 10,
      "data": {
        "id": "packaging",
        "name": "包装设计展示",
        "keywords": [
          "包装",
          "packaging",
          "礼盒",
          "gift box",
          "包装设计",
          "unboxing",
          "开箱"
        ],
        "trigger_phrases": [
          "包装设计",
          "包装展示",
          "礼盒图",
          "packaging design",
          "开箱图",
          "gift box"
        ],
        "prompt_template": {
          "type": "packaging design visualization",
          "subject": "{product_description}",
          "display": "{packaging_components}",
          "surface": "premium marble surface",
          "decorative": "scattered luxury elements",
          "lighting": "soft directional with metallic reflections",
          "quality": "premium design presentation, 8K"
        },
        "defaults": {
          "display": "full spread: product, outer box, tissue, ribbon, brand card",
          "decorative": "gold foil, pearls, dried petals, silk fabric"
        },
        "variants": {
          "luxury-gift": {
            "description": "奢华礼盒",
            "overrides": {
              "display": "gift box opened: outer box, inner tray, product, ribbon, brand card",
              "decorative": "gold foil, pearls, dried roses, silk scarf"
            }
          },
          "minimal-eco": {
            "description": "极简环保",
            "overrides": {
              "display": "sustainable packaging: recycled paper, soy ink, simple label",
              "decorative": "natural elements, dried leaves, twine"
            }
          },
          "unboxing": {
            "description": "开箱体验",
            "overrides": {
              "display": "unboxing sequence: box opening, tissue reveal, product discovery"
            }
          }
        },
        "category_tips": {
          "beauty": "label design, ingredient preview, formula through transparent elements",
          "food": "nutritional info area, ingredient imagery, freshness seals",
          "fashion": "branded tissue, garment tag, care instructions, shopping bag",
          "electronics": "box design, inner foam, cable organization, quick-start guide"
        },
        "examples": [
          "Luxury {category} packaging concept. Full spread: (1) product with lid, label visible, (2) outer gift box: embossed pattern, gold logo, magnetic closure, (3) tissue with subtle watermark, (4) satin ribbon with monogram, (5) brand card gold foil, (6) sustainable fill. On marble with gold foil, pearls, dried petals. Soft directional lighting, metallic reflections. Premium presentation, 8K, 1080x1620px",
          "Premium packaging showcase. {product} in gift box open, tissue, ribbon, brand card, luxury unboxing. Professional photography, 1080x1080px",
          "{category} packaging concept on white. Multiple angles, clean presentation, design mockup, 1080x1080px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "11-infographic.json",
      "hash": "94ff540b8e03303f55ee0fc332b670e2bd210e97dc06da8e782585948b2d70be",
      "upstreamNumber": 11,
      "data": {
        "id": "infographic",
        "name": "信息图/A+Content",
        "keywords": [
          "信息图",
          "infographic",
          "A+",
          "详情页",
          "卖点图",
          "产品信息图",
          "产品详情"
        ],
        "trigger_phrases": [
          "信息图",
          "产品信息图",
          "详情页图",
          "A+Content",
          "卖点图",
          "infographic"
        ],
        "prompt_template": {
          "type": "e-commerce product infographic",
          "subject": "{product_description}",
          "features": "{feature_list}",
          "layout": "structured sections with clear hierarchy",
          "data_vis": "{data_elements}",
          "color_scheme": "{brand_colors}",
          "quality": "professional e-commerce design, mobile-friendly"
        },
        "defaults": {
          "features": "4-6 key features with icons and descriptions",
          "layout": "clean grid, product as focal point",
          "data_vis": "simple charts or comparison tables",
          "color_scheme": "brand-consistent palette"
        },
        "variants": {
          "amazon-a-plus": {
            "description": "亚马逊A+风格",
            "overrides": {
              "layout": "4-quadrant module with banner, feature blocks, comparison, badges",
              "data_vis": "comparison table, ingredient chart, certification badges"
            }
          },
          "feature-grid": {
            "description": "卖点网格",
            "overrides": {
              "layout": "product centered with callout lines to feature blocks"
            }
          },
          "story-flow": {
            "description": "故事线信息流",
            "overrides": {
              "layout": "vertical story: problem → solution → features → results"
            }
          }
        },
        "category_tips": {
          "beauty": "ingredient breakdown with %, before/after data, dermatologist badges",
          "electronics": "spec comparison, performance metrics, compatibility icons",
          "food": "nutritional visualization, ingredient sourcing, recipe flow",
          "fashion": "size guide, material composition, care instructions"
        },
        "examples": [
          "Complex Amazon A+ Content module. Top banner with brand and tagline. Main: 4 quadrants each showing product detail with labeled feature: (1) {f1}, (2) {f2}, (3) {f3}, (4) {f4}. Below: comparison table. Bottom: spec chart and certification badges. {color} palette. Mobile-first, professional e-commerce, 2000x2500px",
          "Product infographic. Left: {product} on gradient. Right: {n} feature blocks with icons vertically, callout lines connecting to product. Clean modern, {color} accents, 2000x2000px",
          "{category} specification guide. Product centered with dimension callouts. Feature highlights with icons. Data visualization. Clean typography, mobile-friendly, 2000x2000px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "12-creative-concept.json",
      "hash": "712d91e645d858220b48988322aa0aecb158e1cce6724ea72bdc67c01bcbdc26",
      "upstreamNumber": 12,
      "data": {
        "id": "creative-concept",
        "name": "创意概念广告图",
        "keywords": [
          "创意图",
          "概念图",
          "creative",
          "概念广告",
          "品牌广告",
          "创意广告",
          "concept art"
        ],
        "trigger_phrases": [
          "创意广告",
          "概念图",
          "品牌广告",
          "创意素材",
          "品牌宣传",
          "creative concept"
        ],
        "prompt_template": {
          "type": "creative advertising photography",
          "subject": "{product_description}",
          "concept": "{creative_concept}",
          "effects": "{special_effects}",
          "color_palette": "{bold_palette}",
          "art_direction": "{art_style}",
          "quality": "award-winning advertising photography, ultra-detailed, cinematic"
        },
        "defaults": {
          "concept": "dynamic product with unexpected visual elements",
          "effects": "dramatic visual impact",
          "color_palette": "bold unusual combinations",
          "art_direction": "strong visual narrative"
        },
        "variants": {
          "splash-dynamic": {
            "description": "飞溅动态效果",
            "overrides": {
              "effects": "water splash / powder explosion frozen in motion, high-speed photography",
              "art_direction": "dramatic, vivid, commercial style"
            }
          },
          "surreal": {
            "description": "超现实概念",
            "overrides": {
              "concept": "product in unexpected surreal environment",
              "effects": "gravity-defying, impossible geometry"
            }
          },
          "minimal-art": {
            "description": "极简艺术风格",
            "overrides": {
              "concept": "product as art object in minimalist composition",
              "color_palette": "monochromatic or two-tone"
            }
          }
        },
        "category_tips": {
          "beauty": "floating product with splash, ethereal lighting, formula particles",
          "electronics": "holographic interfaces, data visualization, futuristic",
          "food": "ingredient explosion, dynamic pour/splash, steam and fire",
          "fashion": "editorial art direction, dramatic poses, fabric in motion"
        },
        "examples": [
          "{product} floating in {dramatic_environment}, {effects: splash/particles/smoke}, {bold colors}, art direction: {style}, ultra-detailed, cinematic lighting, award-winning advertising, 8K",
          "{product} with dynamic elements frozen in motion, high-speed photography, dramatic lighting, vivid colors, commercial {category}. Bold concept, 8K",
          "Creative advertising. {product} in {artistic setting}. {colors} palette. Dramatic lighting with {effects}. Art direction: {style}. Award-winning, cinematic, 8K"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "13-size-spec.json",
      "hash": "14a21b95f69f4ecd46ad19e0acd9df16cfe59b65ce32c2ab129e572b0c91aa8a",
      "upstreamNumber": 13,
      "data": {
        "id": "size-spec",
        "name": "尺寸规格+使用步骤图",
        "keywords": [
          "尺寸",
          "规格",
          "尺寸图",
          "使用步骤",
          "规格图",
          "dimension",
          "how to use",
          "使用指南"
        ],
        "trigger_phrases": [
          "尺寸图",
          "规格图",
          "使用步骤图",
          "尺寸标注",
          "how to use",
          "使用指南",
          "产品规格"
        ],
        "prompt_template": {
          "type": "product specification and usage guide infographic",
          "subject": "{product_description}",
          "dimensions": "{size_annotations}",
          "steps": "{usage_steps}",
          "extras": "{additional_info}",
          "style": "clean professional layout",
          "quality": "professional e-commerce infographic"
        },
        "defaults": {
          "dimensions": "height, width with measurement lines and arrows",
          "steps": "3-4 step numbered usage guide with icons",
          "extras": "ingredient highlights or feature badges",
          "style": "clean white, professional typography"
        },
        "variants": {
          "premium-editorial": {
            "description": "高端杂志风格",
            "overrides": {
              "style": "luxury editorial with decorative elements, gold accents, premium typography"
            }
          },
          "technical": {
            "description": "技术规格风格",
            "overrides": {
              "dimensions": "detailed specs with reference objects for scale",
              "extras": "comparison charts, certification badges, data grids"
            }
          },
          "ritual-guide": {
            "description": "使用仪式指南",
            "overrides": {
              "steps": "decorative numbered ritual guide with small illustrations"
            }
          }
        },
        "category_tips": {
          "beauty": "dimension callout badge, usage ritual steps, ingredient percentages",
          "electronics": "precise dimensions with comparison objects, port specs",
          "food": "serving size, preparation steps, nutritional highlights",
          "fashion": "size chart with body measurements, care instructions"
        },
        "examples": [
          "Premium {category} specification and ritual guide, luxury editorial. White background, subtle border. Top: {product} centered with dimension badge. Left: 4-step usage guide with decorative icons. Right: highlights with colored pills. Bottom: {data}. Decorative corner accents. Magazine-quality, 2000x2800px",
          "Product detail card. Left: {product} with dimension annotations {measurements}, arrows and lines. Right: {n}-step usage guide with icons. White background, minimal, professional, 2000x1500px",
          "{category} specification card. {product} with detailed dimensions and reference object. Usage steps with icons. Key features. Clean layout, mobile-friendly, 2000x2000px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "14-multi-product.json",
      "hash": "11b329a915656d7153685b7a535c0e99d482cbc5c12514f7750cb169e577358e",
      "upstreamNumber": 14,
      "data": {
        "id": "multi-product",
        "name": "多产品套装/组合展示",
        "keywords": [
          "套装",
          "组合",
          "多产品",
          "bundle",
          "gift set",
          "礼盒",
          "系列展示"
        ],
        "trigger_phrases": [
          "套装图",
          "多产品展示",
          "产品组合",
          "bundle image",
          "礼盒展示",
          "系列图",
          "gift set"
        ],
        "prompt_template": {
          "type": "multi-product bundle photography",
          "subject": "{product_set_description}",
          "arrangement": "organized composition, all products clearly visible",
          "background": "{background_description}",
          "decorative": "{decorative_elements}",
          "quality": "professional product photography, 8K"
        },
        "defaults": {
          "arrangement": "organized with consistent spacing, all visible, no overlap",
          "background": "clean suitable for showcase",
          "decorative": "luxury elements for gift-ready presentation"
        },
        "variants": {
          "gift-set": {
            "description": "礼盒套装",
            "overrides": {
              "arrangement": "products in gift box with cards",
              "decorative": "satin ribbon, gold foil, dried flowers, pearls"
            }
          },
          "routine-set": {
            "description": "使用程序套装",
            "overrides": {
              "arrangement": "products in order of use, step indicators"
            }
          },
          "lineup": {
            "description": "产品线排列",
            "overrides": {
              "arrangement": "neat row, hero centered and larger",
              "decorative": "minimal, clean",
              "background": "white seamless"
            }
          }
        },
        "category_tips": {
          "beauty": "complete routine (cleanser → toner → serum → cream), gift-ready",
          "food": "product range, variety pack, flavor assortment",
          "fashion": "outfit coordination pieces, colorway options",
          "home": "collection of coordinating items"
        },
        "examples": [
          "Luxury {category} gift set on premium surface: {product_list}. Organized composition with product cards. Scattered: gold foil, pearls, dried flowers, velvet ribbon. Bottom left: set description. Bottom right: price with original crossed out. Soft directional lighting, premium photography, 8K",
          "Premium {category} routine set. Main product centered, lid open showing texture. Surrounding: routine products arranged naturally. Soft background, decorative elements. Warm studio lighting, gift-ready, 2000x2000px",
          "{category} gift set display. {n} products neat row, consistent spacing. Clean photography, soft shadows, professional bundle image, no text, 2000x2000px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "15-livestream.json",
      "hash": "4b4d30db560857ad991888012888d56bc6a18365a6b4c2d80c4478e309dcf2b0",
      "upstreamNumber": 15,
      "data": {
        "id": "livestream",
        "name": "电商直播间场景",
        "keywords": [
          "直播",
          "livestream",
          "直播间",
          "电商直播",
          "直播截图",
          "抖音直播",
          "带货"
        ],
        "trigger_phrases": [
          "直播图",
          "直播间截图",
          "电商直播",
          "livestream",
          "抖音直播",
          "带货图",
          "live commerce"
        ],
        "prompt_template": {
          "type": "e-commerce livestream screenshot",
          "host": "{host_description}",
          "product_action": "{product_demonstration}",
          "background": "real home-style livestream setup",
          "ui_overlay": "live commerce UI elements",
          "lighting": "ring light from front, warm indoor overhead mixing in",
          "quality": "authentic phone screen capture, NOT AI-generated look"
        },
        "defaults": {
          "host": "friendly person, natural expression, visible skin texture, NOT retouched",
          "product_action": "holding product close to camera showing details",
          "background": "organized but real product shelf, LED strip, small plants",
          "ui_overlay": "viewer count, LIVE badge, comments, product card, buy button",
          "lighting": "ring light circular catchlight in eyes, warm indoor overhead"
        },
        "variants": {
          "douyin": {
            "description": "抖音直播风格",
            "overrides": {
              "ui_overlay": "Douyin UI: LIVE badge, viewer count, scrolling comments, product card with price and buy button, gift icons, shopping cart"
            }
          },
          "taobao": {
            "description": "淘宝直播风格",
            "overrides": {
              "ui_overlay": "Taobao Live UI: product listing, coupon badges, viewer count, chat"
            }
          },
          "setup": {
            "description": "直播间布景展示",
            "overrides": {
              "ui_overlay": "no UI overlay, showing physical setup",
              "background": "full view of studio with lighting, backdrop, shelves"
            }
          }
        },
        "category_tips": {
          "beauty": "host demonstrating application, showing texture, real-time swatching",
          "fashion": "host wearing/showing clothing, fit demo, fabric close-up",
          "food": "host tasting/preparing, showing freshness, unboxing",
          "electronics": "host demonstrating features, hands-on product demo"
        },
        "examples": [
          "Ultra-realistic Douyin livestream screenshot, phone screen capture. Host in casual {outfit}, minimal makeup, visible pores and skin texture, NOT retouched. Demonstrating {product}, showing details, other hand gesturing. Ring light natural shine, NOT plastic AI look. Background: real home setup - product shelf, whiteboard with prices, string lights, coffee mug. Phone UI: LIVE badge, viewer count, scrolling comments, product card with price, yellow buy button. Warm cast, slight noise, Kodak Portra 400 tone, NOT AI-generated look, 1080x1920px",
          "Phone screenshot of livestream. Host holding {product}. Ring light catchlight. Product shelf behind. Phone noise, warm indoor, NOT professional, real livestream feel, 1080x1920px",
          "Livestream scene. Host with {product} in home studio. Ring light, visible skin texture. Product display. Live UI elements. Authentic phone capture, 1080x1920px"
        ],
        "anti_ai_tips": "CRITICAL: (1) Phone screen capture style, (2) Ring light: circular catchlight in eyes, (3) Real skin: pores, undereye darkness, NOT smoothed, (4) Real environment: slightly messy, real objects, (5) Warm yellowish cast, (6) Slight noise, (7) 'NOT AI-generated look, NOT plastic smooth', (8) Kodak Portra 400 tone, (9) Realistic UI overlay",
        "supports_image_reference": true
      }
    },
    {
      "file": "16-try-on-virtual.json",
      "hash": "fc48de1ca577bd78087ee03cde23316df664390254cac9694f29bc769f25c444",
      "upstreamNumber": 16,
      "data": {
        "id": "try-on-virtual",
        "name": "虚拟试穿/产品融入场景",
        "keywords": [
          "试穿",
          "融入",
          "虚拟试穿",
          "try on",
          "场景融合",
          "产品融入",
          "product placement"
        ],
        "trigger_phrases": [
          "虚拟试穿",
          "产品融入场景",
          "try on",
          "场景融合",
          "产品植入",
          "场景化融入"
        ],
        "prompt_template": {
          "type": "product integration / virtual try-on",
          "subject": "{product_description} naturally integrated into {scene_type}",
          "setting": "{detailed_scene}",
          "atmosphere": "{mood_and_lighting}",
          "integration": "product prominently displayed, naturally belonging in scene",
          "quality": "cinematic lifestyle photography, 8K"
        },
        "defaults": {
          "setting": "luxury interior or lifestyle environment matching product",
          "atmosphere": "warm, inviting, aspirational",
          "integration": "product as natural focal point"
        },
        "variants": {
          "interior-luxury": {
            "description": "奢华室内场景",
            "overrides": {
              "setting": "high-end spa/hotel/luxury home, marble, gold fixtures",
              "atmosphere": "cinematic depth, warm grading, premium"
            }
          },
          "outdoor-natural": {
            "description": "户外自然场景",
            "overrides": {
              "setting": "natural outdoor, organic elements",
              "atmosphere": "golden hour sunlight, natural and free"
            }
          },
          "studio-editorial": {
            "description": "棚拍编辑风格",
            "overrides": {
              "setting": "professional studio with styled backdrop",
              "atmosphere": "controlled studio lighting, editorial quality"
            }
          }
        },
        "category_tips": {
          "beauty": "spa bathroom, vanity mirror, botanical elements, skincare ritual",
          "fashion": "model wearing item in appropriate setting, natural styling",
          "furniture": "product in complete room setting, complementary decor",
          "electronics": "modern desk setup, in-use context, tech-forward"
        },
        "examples": [
          "Cinematic luxury {category} integration. High-end {interior} with {materials}. {product} prominently displayed. Morning sunlight through frosted glass, ethereal light rays. Fresh flowers, botanical elements. Product label visible, ingredient card beside it. Decorative: tray, pearls, gold foil. Color: {colors}. Cinematic depth, warm grading, premium, 8K, 1080x1620px",
          "{product} naturally in {scene}, morning sunlight, soft shadows, botanical touches, warm atmosphere, professional lifestyle photography, 8K, 1080x1350px",
          "{product} integrated into complete {category} lifestyle scene. {person} at {location}, products arranged naturally, natural light, warm atmosphere. Professional lifestyle, 1080x1350px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "17-exploded-view.json",
      "hash": "f2d68480d17eca6ccf31f87e68e1739e242ab0cd2499899aa195d808772e31b7",
      "upstreamNumber": 17,
      "data": {
        "id": "exploded-view",
        "name": "技术拆解/爆炸图",
        "keywords": [
          "拆解图",
          "爆炸图",
          "exploded view",
          "技术图",
          "结构图",
          "内部结构",
          "拆机",
          "teardown",
          "cross-section"
        ],
        "trigger_phrases": [
          "产品拆解",
          "爆炸图",
          "内部结构",
          "技术拆解",
          "exploded view",
          "产品组件",
          "零件展示"
        ],
        "prompt_template": {
          "type": "technical product exploded view",
          "subject": "{product_description}",
          "components": "{component_list}",
          "arrangement": "vertical stack with increasing spacing",
          "background": "clean light gray or white",
          "labels": "thin leader lines to callout labels with name and key spec",
          "quality": "8K, technical illustration, precise component rendering"
        },
        "defaults": {
          "arrangement": "vertical exploded stack",
          "background": "clean light gray",
          "labels": "component name + material + core spec"
        },
        "variants": {
          "blueprint": {
            "description": "蓝图风格",
            "overrides": {
              "background": "dark charcoal with cyan grid lines",
              "labels": "white and gold typography, blueprint aesthetic"
            }
          },
          "minimal": {
            "description": "极简白底",
            "overrides": {
              "background": "pure white, no grid",
              "labels": "minimal black text, thin gray leader lines"
            }
          },
          "apple-style": {
            "description": "Apple产品拆解风格",
            "overrides": {
              "arrangement": "isometric floating with precise spacing",
              "background": "deep gradient from charcoal to black",
              "labels": "elegant sans-serif, golden accent lines"
            }
          },
          "editorial": {
            "description": "杂志编辑风格",
            "overrides": {
              "background": "warm off-white with subtle texture",
              "labels": "serif font callouts, hand-drawn arrow style"
            }
          }
        },
        "category_tips": {
          "electronics": "highlight circuit boards, chips, battery modules with spec labels",
          "audio": "show speaker drivers, diaphragms, ANC modules, battery size",
          "wearables": "include sensors, display panel, waterproof seals, strap mechanism",
          "home_appliance": "show motor, filter system, internal wiring, control board",
          "phone_accessories": "highlight charging coils, magnet arrays, protective layers",
          "camera": "show lens elements, sensor, image processor, stabilization unit"
        },
        "examples": [
          "Product exploded view. {product} disassembled into 5 components floating in mid-air with spacing, arranged vertically. Clean light gray background. Soft shadows beneath each part. Technical illustration style, 8K, no text",
          "{product} technical exploded view infographic. Components floating in isometric arrangement with thin connecting lines. Each component labeled with name and key spec. Clean white background, blueprint-inspired accent lines, 8K"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "18-ghost-mannequin.json",
      "hash": "8a1bdb79e27a784b2d7f6dab2f01898a25017688953378c57c3e450ae1b17590",
      "upstreamNumber": 18,
      "data": {
        "id": "ghost-mannequin",
        "name": "隐形模特",
        "keywords": [
          "隐形模特",
          "ghost mannequin",
          "invisible model",
          "3D服装",
          "服装展示",
          "无人模特",
          "中空模特",
          "flat mannequin"
        ],
        "trigger_phrases": [
          "隐形模特",
          "ghost mannequin",
          "3D服装展示",
          "无人穿着展示",
          "服装立体展示",
          "invisible mannequin"
        ],
        "prompt_template": {
          "type": "ghost mannequin product photography",
          "subject": "{product_description}",
          "form": "invisible mannequin creating natural 3D body shape",
          "details": "natural shoulder slope, bust/chest contour, waist curve visible",
          "background": "clean white or soft gray gradient",
          "lighting": "three-point studio setup, gentle dimension",
          "quality": "8K, fashion e-commerce standard photography"
        },
        "defaults": {
          "form": "natural body contours - shoulders, bust, waist",
          "background": "soft warm gray gradient",
          "lighting": "three-point studio setup creating gentle dimension"
        },
        "variants": {
          "white-clean": {
            "description": "纯白干净",
            "overrides": {
              "background": "pure white seamless",
              "lighting": "bright even commercial lighting"
            }
          },
          "editorial": {
            "description": "杂志风格",
            "overrides": {
              "background": "moody dark gradient from charcoal to deep gray",
              "lighting": "spotlight from above creating dramatic highlight on shoulders"
            }
          },
          "editorial-detail": {
            "description": "展示内衬细节",
            "overrides": {
              "details": "garment partially open revealing inner lining tag, rolled sleeves showing lining contrast"
            }
          },
          "lifestyle": {
            "description": "带环境道具",
            "overrides": {
              "background": "minimal studio with subtle editorial prop - single branch or flower in corner"
            }
          }
        },
        "category_tips": {
          "shirts": "collar standing naturally, top buttons detail, cuff visibility",
          "dresses": "natural waist cinch, skirt drape showing fabric weight, back zipper detail",
          "coats": "architectural shoulder structure, fabric texture visible, button and pocket details",
          "knitwear": "visible knit pattern and texture, natural stretch around body contours",
          "tshirts": "casual relaxed drape, crew or v-neck sitting naturally, sleeve length proportion",
          "activewear": "compression fit showing body contour, moisture-wicking fabric texture, logo placement"
        },
        "examples": [
          "Ghost mannequin photography. {product} on invisible mannequin, natural body contours visible. Fabric drapes naturally showing material weight. Pure white background. Soft studio lighting, 8K, fashion e-commerce standard",
          "Premium ghost mannequin photography. {product} on invisible mannequin, garment partially open revealing inner lining. Background: soft warm gray gradient. Three-point studio lighting, Phase One quality, 8K"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "19-multi-angle-grid.json",
      "hash": "3d0a3491181b18e88d277e10b77e124c559d0ccec294a5cf69416b30bbf4e4c9",
      "upstreamNumber": 19,
      "data": {
        "id": "multi-angle-grid",
        "name": "产品多角度网格",
        "keywords": [
          "多角度",
          "网格",
          "grid",
          "多面",
          "颜色展示",
          "colorway",
          "产品角度",
          "catalog grid",
          "产品目录"
        ],
        "trigger_phrases": [
          "多角度展示",
          "产品网格",
          "多面展示",
          "颜色对比",
          "multi-angle",
          "grid layout",
          "产品目录图",
          "多色展示"
        ],
        "prompt_template": {
          "type": "product photography grid layout",
          "subject": "{product_description}",
          "grid": "2x2 or 3x3 equal squares",
          "variation": "different angles or colorways",
          "background": "clean white in each cell",
          "separators": "thin white borders between cells",
          "quality": "8K, catalog photography, uniform lighting across all cells"
        },
        "defaults": {
          "grid": "2x2 grid, 4 views",
          "variation": "front, side, back, top-down angles",
          "background": "clean white per cell",
          "separators": "thin white borders"
        },
        "variants": {
          "angle-view": {
            "description": "多角度视角",
            "overrides": {
              "variation": "front, side, back, top-down, 3/4 angle views",
              "grid": "2x2 or 3x3"
            }
          },
          "colorway": {
            "description": "多配色展示",
            "overrides": {
              "variation": "same product in different colors, consistent 3/4 angle",
              "grid": "3x3 for 9 colors or 2x3 for 6 colors"
            }
          },
          "feature-grid": {
            "description": "带功能标注网格",
            "overrides": {
              "variation": "each cell shows different product feature with label and icon",
              "grid": "hero image left + 4 smaller shots right column"
            }
          },
          "comparison": {
            "description": "对比网格",
            "overrides": {
              "variation": "before/after or product vs competitor in side-by-side grid"
            }
          }
        },
        "category_tips": {
          "beauty": "show bottle angle, cap detail, texture close-up, and open product",
          "electronics": "show front face, side ports, back panel, and included accessories",
          "fashion": "show front view, back view, detail close-up, and fabric texture",
          "food": "show packaging front, back nutrition, open product, and serving suggestion",
          "home": "show full product, detail angle, material texture, and in-context shot",
          "sports": "show product front, side profile, sole/bottom, and action usage shot"
        },
        "examples": [
          "2x2 product grid. {product} shown from 4 angles: front, side, back, top-down. Clean white background per cell. Thin borders. Uniform studio lighting, 8K, 2000x2000px",
          "3x3 color variation grid. Same {product} in 9 different colors, identical 3/4 angle. Clean white cells, subtle drop shadow. Professional catalog, 8K, 2000x2000px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "20-magazine-editorial.json",
      "hash": "ac2d545a6beb60b9f8a2e308bb82ff3fd34e1e4cbd737cc3a6bc9f24154d85bd",
      "upstreamNumber": 20,
      "data": {
        "id": "magazine-editorial",
        "name": "杂志大片/封面",
        "keywords": [
          "杂志",
          "封面",
          "杂志大片",
          "editorial",
          "magazine cover",
          "时尚大片",
          "Vogue",
          "时尚摄影",
          "fashion editorial"
        ],
        "trigger_phrases": [
          "杂志封面",
          "杂志大片",
          "时尚大片",
          "editorial",
          "magazine cover",
          "品牌大片",
          "时尚杂志",
          "封面图"
        ],
        "prompt_template": {
          "type": "fashion/beauty magazine cover editorial",
          "subject": "{product_description}",
          "model": "person holding or wearing product in editorial pose",
          "makeup_hair": "polished editorial beauty look",
          "background": "studio backdrop in warm/tonal color",
          "lighting": "beauty dish + rim light, editorial setup",
          "layout": "magazine masthead area at top, barcode space at bottom",
          "quality": "8K, Vogue-quality editorial photography"
        },
        "defaults": {
          "lighting": "beauty dish from front-left, soft rim light on hair",
          "background": "studio backdrop warm peach-nude tone",
          "layout": "masthead area top, issue text bottom-left, barcode bottom-right"
        },
        "variants": {
          "beauty-cover": {
            "description": "美妆封面",
            "overrides": {
              "model": "close-up portrait with glowing skin, holding skincare near face",
              "makeup_hair": "dewy natural, glossy lips, subtle smoky eye"
            }
          },
          "fashion-cover": {
            "description": "时尚封面",
            "overrides": {
              "model": "full or 3/4 body shot wearing fashion product, confident pose",
              "makeup_hair": "bold editorial makeup, high-fashion styling"
            }
          },
          "fragrance-editorial": {
            "description": "香水大片",
            "overrides": {
              "model": "person in contemplative pose with fragrance bottle, atmospheric",
              "background": "dark moody backdrop with atmospheric haze"
            }
          },
          "minimal-editorial": {
            "description": "极简杂志内页",
            "overrides": {
              "background": "clean white studio, no backdrop color",
              "layout": "no masthead, clean full-bleed editorial image"
            }
          }
        },
        "category_tips": {
          "skincare": "dewy skin, product held at chin level, beauty lighting",
          "fragrance": "atmospheric smoke, contemplative mood, bottle prominent",
          "fashion": "confident pose, outfit fully visible, dramatic lighting",
          "jewelry": "close-up on hands/neck, editorial styling, luxury backdrop",
          "haircare": "hair as hero element, movement and texture, beauty lighting",
          "makeup": "bold lip or eye focus, product in hand, editorial beauty"
        },
        "examples": [
          "Beauty magazine cover. Woman with glowing skin holding {product} near face. Beauty dish lighting, soft background. Top area for masthead. Vogue-quality editorial, 8K, 1080x1350px",
          "Fashion editorial magazine cover. Striking woman wearing {product} in contemplative pose. Bold makeup, sleek hair. High-contrast editorial lighting. Magazine layout overlay with border frame. 8K, 1080x1350px"
        ],
        "anti_ai_tips": "For authentic editorial feel: specify actual camera (Phase One IQ4, Canon EOS R5 85mm f/1.2), add visible skin texture, use real beauty lighting terminology",
        "supports_image_reference": true
      }
    },
    {
      "file": "21-seasonal-campaign.json",
      "hash": "7a17dc8cc64913f2566e1f23dfb896ffe6f5f8fb566dd0645dd38a034d35e856",
      "upstreamNumber": 21,
      "data": {
        "id": "seasonal-campaign",
        "name": "季节主题网格",
        "keywords": [
          "季节",
          "四季",
          "campaign",
          "季节主题",
          "seasonal",
          "春夏秋冬",
          "年度campaign",
          "品牌campaign",
          "季节变体"
        ],
        "trigger_phrases": [
          "季节主题",
          "四季展示",
          "seasonal campaign",
          "年度campaign",
          "春夏秋冬",
          "季节变体",
          "品牌年度",
          "四季网格"
        ],
        "prompt_template": {
          "type": "seasonal product campaign grid",
          "subject": "{product_description}",
          "layout": "2x2 grid, one product in four seasonal settings",
          "spring": "pastel tones, blossoms, morning dew, soft light",
          "summer": "bright warm tones, tropical elements, golden light",
          "autumn": "warm amber, dried leaves, cinnamon, window light",
          "winter": "cool blues, pine branches, frost, moonlight",
          "quality": "8K, brand campaign photography, consistent product placement"
        },
        "defaults": {
          "layout": "2x2 grid with thin white or gold borders",
          "consistency": "same product angle and size across all four quadrants"
        },
        "variants": {
          "four-seasons": {
            "description": "经典四季",
            "overrides": {
              "layout": "2x2, each quadrant a full seasonal scene"
            }
          },
          "holiday-series": {
            "description": "节日系列",
            "overrides": {
              "layout": "2x3 or 3x2 grid, each cell a different holiday theme (Valentine's, Easter, Summer, Halloween, Thanksgiving, Christmas)"
            }
          },
          "day-to-night": {
            "description": "日夜变体",
            "overrides": {
              "layout": "2x2 grid, same scene at dawn, morning, afternoon, night"
            }
          },
          "travel-series": {
            "description": "旅行主题",
            "overrides": {
              "layout": "2x2 grid, product in 4 travel destinations with local elements"
            }
          }
        },
        "category_tips": {
          "skincare": "spring=blossoms+dew, summer=sun+kisses, autumn=cozy+cream, winter=frost+glow",
          "fragrance": "each season with matching botanical elements and color palette",
          "fashion": "season-appropriate styling visible in each quadrant",
          "food": "seasonal ingredients and color palette matching product",
          "home": "seasonal decor elements and lighting mood",
          "candles": "seasonal scents visualized through corresponding natural elements"
        },
        "examples": [
          "2x2 seasonal grid. Same {product} in four settings: Spring with cherry blossoms, Summer with citrus and sunshine, Autumn with maple leaves, Winter with pine and snow. Consistent product angle, 8K, 2000x2000px",
          "Brand seasonal campaign 2x2 grid. {product} in four seasonal worlds: Spring=pastel marble+dew, Summer=tropical leaves+sunset, Autumn=walnut wood+cinnamon, Winter=frosted glass+pine. Season labels in serif font, 8K"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "22-luxury-atmospherics.json",
      "hash": "e36ca1a4c7eff4b9f530dc33dc1ea457362b02fd98789848e1a619083868576d",
      "upstreamNumber": 22,
      "data": {
        "id": "luxury-atmospherics",
        "name": "奢华氛围渲染",
        "keywords": [
          "奢华",
          "氛围",
          "烟雾",
          "高级感",
          "luxury",
          "atmospheric",
          "梦幻",
          "高端",
          "premium",
          "烟雾效果",
          "金色"
        ],
        "trigger_phrases": [
          "奢华氛围",
          "高端渲染",
          "梦幻效果",
          "luxury campaign",
          "氛围渲染",
          "高端广告",
          "品牌大片",
          "premium visual"
        ],
        "prompt_template": {
          "type": "luxury product photography with atmospheric effects",
          "subject": "{product_description}",
          "surface": "polished dark reflective surface",
          "atmosphere": "wisps of smoke, floating petals, light particles",
          "lighting": "dramatic rim light + cool ambient fill",
          "background": "infinite dark void with subtle gradient",
          "quality": "8K, award-winning luxury advertising photography"
        },
        "defaults": {
          "surface": "polished obsidian or black marble platform",
          "atmosphere": "purple-blue smoke wisps + floating elements",
          "lighting": "golden rim light from upper-left, cool blue backlight"
        },
        "variants": {
          "floral-dream": {
            "description": "花卉梦幻",
            "overrides": {
              "atmosphere": "fresh flower petals floating at various heights catching light, scattered gold leaf particles"
            }
          },
          "smoke-mystique": {
            "description": "烟雾神秘",
            "overrides": {
              "atmosphere": "multi-layered violet and midnight blue smoke swirling around product"
            }
          },
          "golden-luxe": {
            "description": "金色奢华",
            "overrides": {
              "atmosphere": "golden bokeh particles, warm amber glow, scattered gold flakes"
            }
          },
          "ice-crystal": {
            "description": "冰晶冷冽",
            "overrides": {
              "atmosphere": "floating ice crystals, frost patterns, diamond-like light refractions",
              "lighting": "cool platinum spotlight, ice-blue ambient"
            }
          }
        },
        "category_tips": {
          "fragrance": "multi-layer smoke + matching botanical elements, amber liquid visible inside",
          "skincare": "ethereal glow around product, subtle condensation, dreamy quality",
          "jewelry": "diamond-like light bokeh, dark background, sparkle and reflection focus",
          "wine": "rich amber or ruby liquid, smoke wisps matching color, candlelight warmth",
          "chocolate": "warm golden particles, cocoa powder dust, rich dark tones",
          "watch": "sharp metallic reflections, precise time visible, ice-blue or golden accent"
        },
        "examples": [
          "Luxury product photography with atmospheric effects. {product} on polished dark surface, surrounded by wisps of purple-blue smoke. Dramatic rim light. Deep black background. 8K, cinematic quality",
          "Premium atmospheric product rendering. {product} on black marble veined with gold. Floating flower petals and gold leaf particles. Multi-point lighting: golden rim light + cool backlight. Dark void background, 8K"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "23-device-mockup.json",
      "hash": "cc0b3f1ee0d80ec7ce00a0ded0ed44cf90657e2ea12c1cd0a23a965a39660a6d",
      "upstreamNumber": 23,
      "data": {
        "id": "device-mockup",
        "name": "设备界面模型",
        "keywords": [
          "设备模型",
          "界面模型",
          "mockup",
          "UI展示",
          "APP截图",
          "设备展示",
          "屏幕展示",
          "device mockup",
          "SaaS"
        ],
        "trigger_phrases": [
          "设备模型",
          "界面展示",
          "mockup",
          "APP展示",
          "网站展示",
          "SaaS展示",
          "UI mockup",
          "产品截图",
          "屏幕展示"
        ],
        "prompt_template": {
          "type": "product device mockup photography",
          "subject": "{product_description} displayed on device screen",
          "device": "laptop or smartphone on desk",
          "screen_content": "modern clean app/dashboard interface",
          "desk_accessories": "coffee cup, plant, notebook, natural work environment",
          "lighting": "natural window light with warm fill",
          "quality": "8K, tech product photography, screen content tack-sharp"
        },
        "defaults": {
          "device": "latest laptop on clean desk",
          "desk_accessories": "coffee cup, small plant, wireless mouse, notebook",
          "lighting": "soft window light from left, warm overhead fill",
          "background": "modern minimal office environment"
        },
        "variants": {
          "single-laptop": {
            "description": "单笔记本",
            "overrides": {
              "device": "MacBook Pro showing product interface, shallow depth of field on screen"
            }
          },
          "multi-device": {
            "description": "多设备联动",
            "overrides": {
              "device": "iPad center + iPhone left + smartwatch right, all showing consistent app UI"
            }
          },
          "phone-only": {
            "description": "手机展示",
            "overrides": {
              "device": "iPhone held at slight angle in hand, lifestyle background, screen clearly visible"
            }
          },
          "office-lifestyle": {
            "description": "办公场景",
            "overrides": {
              "desk_accessories": "Aesop hand cream, Muji pen holder, latte with art, hardcover notebook, trailing plant on shelf",
              "background": "Scandinavian home office with white bookshelf"
            }
          }
        },
        "category_tips": {
          "saas": "show dashboard with charts, KPI cards, data visualizations",
          "mobile_app": "show app interface on phone, notification visible, clean UI",
          "ecommerce_platform": "show store admin dashboard with product listings and analytics",
          "fintech": "show financial dashboard with graphs, portfolio summary",
          "health_app": "show workout tracker, health metrics, progress charts",
          "ai_product": "show chat interface, AI responses, modern dark or light theme"
        },
        "examples": [
          "Product mockup on laptop. Silver laptop on white desk, screen showing modern dashboard with charts. Coffee cup and small plant nearby. Natural window light. Clean product photography, 8K",
          "Multi-device mockup. iPad with keyboard showing {product} app, iPhone showing notification, Apple Watch showing widget. All screens consistent UI in sage green. Scandinavian desk, 8K, 1536x1024px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "24-storefront.json",
      "hash": "9c747c7ee6b7fd04f216946b0f57b7ffe975fa37dd997b7d1581290431c20f46",
      "upstreamNumber": 24,
      "data": {
        "id": "storefront",
        "name": "店铺门面/空间摄影",
        "keywords": [
          "店铺",
          "门面",
          "店面",
          "storefront",
          "空间摄影",
          "室内设计",
          "零售空间",
          "咖啡店",
          "实体店"
        ],
        "trigger_phrases": [
          "店铺门面",
          "店面摄影",
          "空间摄影",
          "零售空间",
          "咖啡店外观",
          "实体店",
          "storefront",
          "室内摄影",
          "店铺设计"
        ],
        "prompt_template": {
          "type": "retail/storefront architectural photography",
          "subject": "{business_description}",
          "exterior": "clean facade with signage and window display",
          "interior": "curated display shelving, consultation area, ambient lighting",
          "lighting": "golden hour exterior or warm ambient interior",
          "quality": "8K, editorial architectural photography, wide-angle sharp"
        },
        "defaults": {
          "exterior": "large glass windows, signage, entrance details, potted plants",
          "lighting": "late afternoon warm golden light, interior already glowing",
          "camera": "wide-angle lens, f/8-f/11 for full sharpness"
        },
        "variants": {
          "exterior": {
            "description": "门面外观",
            "overrides": {
              "exterior": "full storefront view with window display, entrance, street context",
              "interior": "visible through glass windows only"
            }
          },
          "interior": {
            "description": "室内空间",
            "overrides": {
              "interior": "wide-angle interior showing product displays, furniture, lighting design",
              "exterior": "not visible"
            }
          },
          "corner-detail": {
            "description": "角落细节",
            "overrides": {
              "interior": "close-up vignette of a curated corner: consultation table, product samples, single flower"
            }
          },
          "aerial-plan": {
            "description": "俯视平面",
            "overrides": {
              "camera": "top-down bird's eye view showing full floor plan layout"
            }
          }
        },
        "category_tips": {
          "coffee_shop": "espresso machine visible, warm wood tones, latte art, pastry display",
          "beauty_store": "illuminated niches, marble counter, product wall, consultation area",
          "fashion_boutique": "minimalist racks, curated display, premium flooring, mirror accents",
          "restaurant": "table setting, kitchen pass visible, ambient lighting, menu display",
          "gym_studio": "modern equipment, branded wall, natural light, motivational signage",
          "pop_up": "temporary creative installation, bold graphics, unique display fixtures"
        },
        "examples": [
          "Storefront photography. Modern {business} with glass windows showing warm interior. Entrance with potted plants. Golden hour light. Architectural photography, 8K",
          "Premium interior photography of {business}. Wide-angle shot showing product displays, consultation area, herringbone floor. Warm ambient lighting throughout. Architectural Digest quality, 8K, 1536x1024px"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    },
    {
      "file": "25-sports-campaign.json",
      "hash": "5b35105c6d142a614fbcf781d5648c2e308ac71d4c758452483916bd302dad68",
      "upstreamNumber": 25,
      "data": {
        "id": "sports-campaign",
        "name": "运动/健身广告",
        "keywords": [
          "运动",
          "健身",
          "广告",
          "sports",
          "fitness",
          "campaign",
          "运动鞋",
          "运动服",
          "篮球",
          "跑步",
          "健身器材"
        ],
        "trigger_phrases": [
          "运动广告",
          "健身广告",
          "sports campaign",
          "运动品牌",
          "运动大片",
          "健身推广",
          "运动产品广告",
          "运动海报"
        ],
        "prompt_template": {
          "type": "sports/fitness advertising campaign photography",
          "subject": "{product_description}",
          "athlete": "athletic model in dynamic pose with product",
          "props": "sports equipment as visual anchor, exaggerated scale",
          "background": "minimal dark studio with reflective floor",
          "typography": "bold condensed headline + subtitle",
          "quality": "8K, Nike/Under Armour campaign quality"
        },
        "defaults": {
          "background": "dark studio, reflective black floor",
          "typography": "bold condensed font, brand color accent",
          "lighting": "spotlight from above, dramatic body highlights"
        },
        "variants": {
          "product-hero": {
            "description": "产品主视觉",
            "overrides": {
              "athlete": "no model, product floating at dynamic angle",
              "props": "motion lines and speed effects around product"
            }
          },
          "athlete-action": {
            "description": "运动员动态",
            "overrides": {
              "athlete": "athlete mid-action wearing product, stadium lights, lens flare"
            }
          },
          "triptych": {
            "description": "三联画",
            "overrides": {
              "layout": "three vertical panels: close-up detail + action shot + product hero, unified bottom strip with branding"
            }
          },
          "gym-power": {
            "description": "健身力量感",
            "overrides": {
              "athlete": "muscular athlete seated on oversized dumbbell or equipment",
              "props": "exaggerated fitness equipment placed diagonally"
            }
          }
        },
        "category_tips": {
          "running_shoes": "dynamic forward motion, speed lines, track or road surface context",
          "basketball": "mid-dunk or crossover pose, stadium lighting, court texture",
          "fitness_equipment": "athlete using product, sweat detail, gym environment",
          "sportswear": "compression fit visible, fabric technology highlighted, movement pose",
          "protein_supplements": "product with athlete post-workout, muscular definition, energy mood",
          "sports_drink": "splash effects, condensation, vibrant energy colors, hydration theme"
        },
        "examples": [
          "Sports advertising photo. {product} placed diagonally on reflective dark surface. Dramatic side lighting, speed lines around product. Bold headline text. Dynamic and energetic, 8K, 1080x1350px",
          "Fitness brand campaign. Athletic model wearing {product}, seated on large dumbbell. Dark studio with reflective floor. Spotlight from above. 'STRENGTH' bold headline. Nike campaign quality, 8K"
        ],
        "anti_ai_tips": "",
        "supports_image_reference": true
      }
    }
  ]
};
