# 上游来源与本地化

`src/templates/` 与 `UPSTREAM-SKILL.md` 已作为本项目源代码的一部分内置。它们来自：

- 仓库：<https://github.com/liangdabiao/ecom-details-image>
- 固定 commit：`1ec867b743179af3598db55388f65287c4e04de1`
- 原始位置：`.claude/skills/ecom-details-image/`

本包不在运行时访问 Git 仓库、`.claude` Skill 目录或外部网络。`catalog.ts` 将内置模板 JSON 与本项目的 SKU、像素保护、平台预留和队列工作流组合为领域模型；构建脚本把模板复制到 `dist/templates/` 供部署运行时读取。

上游工作树未提供 LICENSE 文件。使用、分发或开源本项目之前，应向上游作者确认许可范围。
