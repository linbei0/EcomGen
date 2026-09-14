import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// 构建期脚本：把 src/suites/ 的内置套图 JSON 固化为静态 manifest（含 SHA-256 内容指纹），
// 运行时不再扫描套图目录。--check 用于校验已提交的 manifest 是否与套图目录同步。
const suitesDir = resolve(import.meta.dirname, "../src/suites");
const manifestPath = resolve(import.meta.dirname, "../src/suites-manifest.ts");
const checkOnly = process.argv.includes("--check");

const entries = readdirSync(suitesDir)
  .filter((name) => /^\d{2}-.+\.suite\.json$/.test(name))
  .sort()
  .map((file) => {
    const raw = readFileSync(resolve(suitesDir, file));
    return {
      file,
      hash: createHash("sha256").update(raw).digest("hex"),
      data: JSON.parse(raw.toString("utf8")),
    };
  });

if (entries.length === 0) throw new Error("No built-in suite JSON files found in src/suites");

const totalHash = createHash("sha256").update(entries.map((entry) => entry.hash).join("\n")).digest("hex");

const content = `// 自动生成文件：由 scripts/generate-suite-manifest.mjs 从 src/suites/ 生成，请勿手改。
// 重新生成：pnpm --filter @ecomgen/ecom-suite gen:suites
export default ${JSON.stringify({ totalHash, suites: entries }, null, 2)};
`;

if (checkOnly) {
  let current = "";
  try {
    current = readFileSync(manifestPath, "utf8");
  } catch {
    // manifest 不存在时同样视为过期
  }
  if (current !== content) {
    console.error("suites-manifest.ts is out of date. Run: pnpm --filter @ecomgen/ecom-suite gen:suites");
    process.exit(1);
  }
} else {
  writeFileSync(manifestPath, content);
}
