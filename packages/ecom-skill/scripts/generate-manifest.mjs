import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// 构建期脚本：把 src/templates/ 的上游模板 JSON 固化为静态 manifest（含 SHA-256 内容指纹），
// 运行时不再扫描模板目录。--check 用于校验已提交的 manifest 是否与模板目录同步。
const templatesDir = resolve(import.meta.dirname, "../src/templates");
const manifestPath = resolve(import.meta.dirname, "../src/templates-manifest.ts");
const checkOnly = process.argv.includes("--check");

const entries = readdirSync(templatesDir)
  .filter((name) => /^\d{2}-.+\.json$/.test(name))
  .sort()
  .map((file) => {
    const raw = readFileSync(resolve(templatesDir, file));
    return {
      file,
      hash: createHash("sha256").update(raw).digest("hex"),
      upstreamNumber: Number.parseInt(file.slice(0, 2), 10),
      data: JSON.parse(raw.toString("utf8")),
    };
  });

if (entries.length === 0) throw new Error("No upstream template JSON files found in src/templates");

const totalHash = createHash("sha256").update(entries.map((entry) => entry.hash).join("\n")).digest("hex");

const content = `// 自动生成文件：由 scripts/generate-manifest.mjs 从 src/templates/ 生成，请勿手改。
// 重新生成：pnpm --filter @ecomgen/ecom-skill gen:templates
export default ${JSON.stringify({ totalHash, templates: entries }, null, 2)};
`;

if (checkOnly) {
  let current = "";
  try {
    current = readFileSync(manifestPath, "utf8");
  } catch {
    // manifest 不存在时同样视为过期
  }
  if (current !== content) {
    console.error("templates-manifest.ts is out of date. Run: pnpm --filter @ecomgen/ecom-skill gen:templates");
    process.exit(1);
  }
} else {
  writeFileSync(manifestPath, content);
}
