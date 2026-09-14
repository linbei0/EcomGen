import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// 构建期脚本：把 skill/ 下的 ecom-suite-forge 技能文件固化为静态 manifest（含 SHA-256 内容指纹），
// 运行时不再扫描技能目录。--check 用于校验已提交的 manifest 是否与技能目录同步。
const skillDir = resolve(import.meta.dirname, "../skill");
const manifestPath = resolve(import.meta.dirname, "../src/skill-manifest.ts");
const checkOnly = process.argv.includes("--check");

function walk(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    })
    .filter((full) => /\.(md|json)$/.test(full));
}

const files = walk(skillDir)
  .map((full) => ({
    path: relative(skillDir, full).split("\\").join("/"),
    full,
  }))
  .sort((a, b) => a.path.localeCompare(b.path))
  .map(({ path, full }) => {
    const raw = readFileSync(full);
    return { path, hash: createHash("sha256").update(raw).digest("hex"), text: raw.toString("utf8") };
  });

if (files.length === 0) throw new Error("No skill files found in ecom-suite-forge/skill");

const totalHash = createHash("sha256").update(files.map((entry) => `${entry.path}:${entry.hash}`).join("\n")).digest("hex");

const content = `// 自动生成文件：由 scripts/generate-skill-manifest.mjs 从 skill/ 生成，请勿手改。
// 重新生成：pnpm --filter @ecomgen/ecom-suite-forge gen:forge-skill
export default ${JSON.stringify({ totalHash, files }, null, 2)};
`;

if (checkOnly) {
  let current = "";
  try {
    current = readFileSync(manifestPath, "utf8");
  } catch {
    // manifest 不存在时同样视为过期
  }
  if (current !== content) {
    console.error("skill-manifest.ts is out of date. Run: pnpm --filter @ecomgen/ecom-suite-forge gen:forge-skill");
    process.exit(1);
  }
} else {
  writeFileSync(manifestPath, content);
}
