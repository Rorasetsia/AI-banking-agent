# 2026-10-24 · 金属聊天框与风险评估插画

模式：内置 image_gen，共2次参考生成；未使用CLI/API回退，不声明工具未提供的具体模型编号。参考图仅提供材质/构图方向，上传原图没有作为网页素材。

## 金属框

- 网页素材：`public/assets/chat-metal-frame-v1.webp`，1254×1254，RGBA、透明内孔与外侧，无损WebP。CSS border-image九切片适配横竖聊天面板。
- 原稿：`output/imagegen/chat-metal-frame-v1.png`。
- 提示词文件：`output/imagegen/chat-metal-frame-v1-prompt.txt`。
- 用户参考：Downloads中的Octagon backgrounds金色八角金属框照片。

完整最终提示词：

```text
Use case: product-mockup. Asset type: production UI border asset for a Chinese premium green AI banking dashboard, to be used with nine-slice border-image around resizable chat windows. Reference image: the attached gold octagonal frame is only a material and beveled construction reference, create a new original frame. Generate ONE precisely front-on square open metal frame with short 45-degree chamfered corners (an elongated rectangle will later be formed by stretching only the central straight rails). Perfectly orthographic, symmetrical geometry. Champagne gold/brushed pale brass with realistic polished beveled ridges, dark bronze recessed groove, thin highlights, quiet studio reflections. Outer frame extends nearly to canvas edges with only 2% transparent margin; chamfers extend only 9% of each side, leaving long horizontal and vertical straight rails. Rails slender, thickness about 2.5% canvas width, with three finely machined bands; not a thick picture frame. Genuinely transparent alpha both outside the frame AND throughout the completely empty center aperture. No white backdrop, no objects inside, no text, no logo, no watermark, no decoration or dramatic glow. Subtle tight shadow only, avoid floating drop shadows. Crisp high resolution material detail suitable for premium web UI.
```

## 风险评估日记插画

- 网页素材：`public/assets/risk-journal-v1.webp`，1536×1024，RGBA、透明背景、无损WebP。
- 原稿：`output/imagegen/risk-journal-v1.png`。
- 提示词文件：`output/imagegen/risk-journal-v1-prompt.txt`。
- 用户参考：Downloads/下载 (6).jpg，仅借鉴稀疏黑白编辑插画的气质。叠层卡片、文本、按钮和交互均由HTML/CSS实现，不是整页截图。

完整最终提示词：

```text
Use case: illustration-story. Asset type: transparent illustration for the front face of a premium stacked-card risk assessment entry on a Chinese green AI banking website. Reference image: attached stacked monochrome cards is a style reference only; do not reproduce its computer character, card layout or words. Create an original sophisticated hand-drawn black ink illustration: an open small personal investment journal containing a tiny unlabeled line chart and simple checklist, a fine pencil lying diagonally along it, and a little magnifying glass examining one chart point. One small muted forest-green leaf integrated beside the journal to tie to a botanical banking brand. Express careful understanding and self-assessment, not investment profits. Sparse playful editorial drawing, clean confident black contour lines, subtle hatching and warm ivory paper touches, largely monochrome with restrained dark-green accent. Centered compact composition, floating objects only, orthographic slight three-quarter view, no rectangular background panel, no frame or surrounding cards. No readable text, no letters, no numbers, no logos, no money symbols, no watermark. Generous transparent margin, genuine transparent alpha background. High resolution crisp fine detail, clean and calm rather than busy.
```

## 题目参考与范围

投资期限、风险承受及分散投资等概念参考[Investor.gov](https://www.investor.gov/introduction-investing/getting-started/asset-allocation)。12题、评分、知识摸底和能力上限均为本项目自定义演示规则，不能称为官方适当性模型或经科学验证的测评。题库在shared/risk-questionnaire.json，服务端统一校验和计分。网页与文档继续标识独立模拟银行。

