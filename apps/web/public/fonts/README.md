# 自托管字体（P9 落入）

设计文档 6.2 要求两款自托管子集化字体，合计 ≤ 200KB，`font-display: swap`：

- `SmileySansSubset.woff2`：得意黑 Smiley Sans（SIL OFL，https://github.com/atelier-anchor/smiley-sans ），按界面用到的汉字子集化，用于 Display 展示字。
- `JetBrainsMonoSubset.woff2`：JetBrains Mono（OFL），latin 子集，用于 Prompt / 请求 ID / 指纹等等宽场景。

npm 上无官方 smiley-sans 包，需从 GitHub Release 下载后用 fonttools/pyftsubset 子集化。
文件缺失时 `global.css` 的 `@font-face` 自动回退系统字体，不影响功能。
