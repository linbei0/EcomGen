# 上游来源与本地化

`skill/` 与 `src/skill-manifest.ts` 已作为本项目源代码的一部分内置。它们来自本仓库的 IDE 技能目录：

- 原始位置：`.agents/skills/ecom-suite-forge/`
- 固定文件：`SKILL.md`、`references/*.md`、`assets/*`（上游未提供独立版本号，以 `src/skill-manifest.ts` 的 SHA-256 内容指纹为准）

本包不在运行时访问 `.agents` Skill 目录或外部网络。构建脚本把技能文本固化为静态 manifest（`src/skill-manifest.ts`），运行时直接加载 manifest，不扫描技能目录。修改 `skill/` 后运行 `pnpm --filter @ecomgen/ecom-suite-forge gen:forge-skill` 重新生成。

`.agents` 被 `.dockerignore` 排除，因此 Docker 构建只能读取本包内嵌的副本；请勿把运行时依赖指回 `.agents`。

上游工作树未提供 LICENSE 文件。使用、分发或开源本项目之前，应向上游作者确认许可范围。
