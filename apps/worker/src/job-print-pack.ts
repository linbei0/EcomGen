import sharp from "sharp";
import type { JobRecord } from "@ecomgen/core";
import type { EcomRepository } from "@ecomgen/core";
import { getPodPrintSpec, POD_MOCKUP_SCENE_VERSION, POD_PRINT_SPEC_VERSION, POD_REPEAT_LAYOUTS } from "@ecomgen/contracts";
import type { PodPrintLayout, PodRepeatLayout } from "@ecomgen/contracts";
import { composeRepeatUnit } from "./repeat-unit.js";
import { computePrintPackPlacement, computePrintPackTileLayout, computeRepeatUnitGeometry } from "./print-pack.js";
import { renderPrintMockup } from "./print-mockups.js";
import { safeName } from "./context.js";
import { JobCancelled } from "./context.js";
import type { WorkerContext } from "./context.js";

/**
 * 规格包：纯本地确定性合成，无外部计费请求。
 * 像素一律来自用户花型（重采样 + 居中排版），不交给生成模型——PIXEL_PROTECTED 纪律在 POD 域的延伸。
 */
export async function executePrintPack(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, storage, updateJob, throwIfCancelled } = ctx;
  throwIfCancelled(job);
  const record = repository.getPrintPackByJobId(job.id);
  if (!record) throw new Error(`Print pack record missing for job ${job.id}`);
  const update = (patch: Parameters<EcomRepository["updatePrintPack"]>[1]) => repository.updatePrintPack(record.id, patch);
  try {
    update({ status: "RUNNING", error: null });
    const pattern = repository.getPattern(record.patternId);
    if (!pattern?.storagePath || !pattern.fileHash) throw new Error("Pattern artwork is missing for this print pack");
    const spec = getPodPrintSpec(record.specId);
    if (!spec) throw new Error(`Print spec is unknown: ${record.specId}`);
    if (POD_PRINT_SPEC_VERSION !== record.specVersion) throw new Error(`Print spec ${spec.id} has been revised (catalog ${POD_PRINT_SPEC_VERSION} != pack ${record.specVersion}); regenerate the pack`);
    const source = await storage.read(pattern.storagePath);
    const meta = await sharp(source).metadata();
    if (!meta.width || !meta.height) throw new Error("Pattern image dimensions are unavailable");
    // 版式快照在 job.input：CENTERED 居中进安全区；TILE 满印平铺（无安全边距）。
    const layout: PodPrintLayout = job.input.layout === "TILE" ? "TILE" : "CENTERED";
    // 平铺排列快照：仅满印生效；输入没有该字段的旧任务按直排（与缺省语义一致）。
    const repeatLayout: PodRepeatLayout = layout === "TILE" && typeof job.input.repeatLayout === "string" && (POD_REPEAT_LAYOUTS as readonly string[]).includes(job.input.repeatLayout)
      ? job.input.repeatLayout as PodRepeatLayout
      : "STRAIGHT";
    await updateJob(job, { progress: 30 });
    let composed: Buffer;
    let placement: ReturnType<typeof computePrintPackPlacement> | null = null;
    let tile: ReturnType<typeof computePrintPackTileLayout> | null = null;
    if (layout === "TILE") {
      tile = computePrintPackTileLayout(spec.widthPx, spec.heightPx, meta.width, meta.height, repeatLayout);
      const tileImage = await sharp(source).ensureAlpha().resize(tile.tileWidth, tile.tileHeight, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
      // 排列只在重复单元内部生效：先按单元几何拼出无缝单元（环绕补画），单元再像直排一样铺满画布。
      const unitImage = await composeRepeatUnit({ data: tileImage, width: tile.tileWidth, height: tile.tileHeight }, tile);
      const composites: Array<{ input: Buffer; left: number; top: number }> = [];
      for (let row = 0; row < tile.rows; row += 1) {
        for (let column = 0; column < tile.columns; column += 1) {
          composites.push({ input: unitImage, left: tile.left + column * tile.unitWidth, top: tile.top + row * tile.unitHeight });
        }
      }
      composed = await sharp({ create: { width: spec.widthPx, height: spec.heightPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(composites)
        .withMetadata({ density: spec.dpi })
        .png()
        .toBuffer();
    } else {
      placement = computePrintPackPlacement(spec.widthPx, spec.heightPx, spec.safeMarginPct, meta.width, meta.height);
      const resized = await sharp(source).ensureAlpha().resize(placement.width, placement.height, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
      composed = await sharp({ create: { width: spec.widthPx, height: spec.heightPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: resized, left: placement.left, top: placement.top }])
        .withMetadata({ density: spec.dpi })
        .png()
        .toBuffer();
    }
    // DPI 只是元数据，真正的印刷精度由像素尺寸决定；density 已在合成管线里写入，
    // 让平台与工厂工具读到 300——不要把整幅 5400×7200 的 PNG 再解码重编码一次。
    const printFile = composed;
    // 品类示意图：扁平版型贴花型（非实拍），买手视角直观看到图案落位。
    const mockup = await renderPrintMockup(spec.category, printFile);
    await updateJob(job, { progress: 70 });
    const storedPrint = await storage.putPrintPackArtifact(record.id, `${safeName(pattern.name)}_${spec.id}`, printFile);
    const storedMockup = await storage.putPrintPackArtifact(record.id, `${safeName(pattern.name)}_${spec.id}_mockup`, mockup);
    // 无缝单元：满印版式的附加产物，源图原生分辨率合成（不放大插值），供 Printful 等第三方平台二次平铺。
    // 直排的单元就是源图本身，直接复用存储缓冲，不再重编码；居中版式不是平铺，不产出。
    let seamlessTile: Buffer | null = null;
    let seamlessSize: { width: number; height: number } | null = null;
    if (layout === "TILE") {
      const seamlessGeometry = computeRepeatUnitGeometry(meta.width, meta.height, repeatLayout);
      seamlessTile = repeatLayout === "STRAIGHT" ? source : await composeRepeatUnit({ data: source, width: meta.width, height: meta.height }, seamlessGeometry);
      seamlessSize = { width: seamlessGeometry.unitWidth, height: seamlessGeometry.unitHeight };
    }
    const storedSeamless = seamlessTile ? await storage.putPrintPackArtifact(record.id, `${safeName(pattern.name)}_${spec.id}_seamless-tile`, seamlessTile) : null;
    const manifest = {
      kind: "ecomgen.print-pack" as const,
      manifestVersion: 1 as const,
      printPackId: record.id,
      jobId: job.id,
      pattern: { id: pattern.id, name: pattern.name, sourceType: pattern.sourceType, fileHash: pattern.fileHash, sourceAssetHash: pattern.sourceAssetHash, tileable: pattern.tileable, tileableScore: pattern.tileableScore, tileableAlgorithmVersion: pattern.tileableCheckedWith },
      spec: { id: spec.id, version: record.specVersion, category: spec.category, dpi: spec.dpi, widthPx: spec.widthPx, heightPx: spec.heightPx, safeMarginPct: spec.safeMarginPct },
      layout,
      repeatLayout: layout === "TILE" ? repeatLayout : null,
      // 镜像的单元接缝两侧像素恒等（构造性无缝）；其余排列的缝等于源图的缝，是否可见由验缝判定回答。
      seam: layout === "TILE" ? (repeatLayout === "MIRROR" ? "by-construction" as const : "depends-on-source-tileability" as const) : null,
      // 场景渲染版本进 manifest：api 侧据此判定旧包示意图过期（重新成包可复得新渲染）。
      mockupScene: POD_MOCKUP_SCENE_VERSION,
      resample: "lanczos3" as const,
      placement,
      tile,
      seamlessTile: seamlessSize,
      // AIGC 标识在此占位：XMP/C2PA 写入集中在导出层实现（见 model-library-roadmap 4.8），不在合成路径重复实现。
      aigcLabeling: { applied: false, note: "XMP labeling is applied at the export layer, not during pack composition." },
      createdAt: new Date().toISOString(),
    };
    const manifestContent = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const storedManifest = await storage.putPrintPackArtifact(record.id, "manifest", manifestContent, ".json");
    const files = [
      { name: `${safeName(pattern.name)}_${spec.id}.png`, kind: "PRINT_FILE" as const, storagePath: storedPrint.path, hash: storedPrint.hash },
      { name: `${safeName(pattern.name)}_${spec.id}_mockup.png`, kind: "MOCKUP" as const, storagePath: storedMockup.path, hash: storedMockup.hash },
      ...(storedSeamless ? [{ name: `${safeName(pattern.name)}_${spec.id}_seamless-tile.png`, kind: "SEAMLESS_TILE" as const, storagePath: storedSeamless.path, hash: storedSeamless.hash }] : []),
      { name: "manifest.json", kind: "MANIFEST" as const, storagePath: storedManifest.path, hash: storedManifest.hash },
    ];
    const updated = update({ status: "SUCCEEDED", files, manifest, error: null });
    if (!updated) throw new Error(`Print pack record disappeared for job ${job.id}`);
    await updateJob(job, { progress: 95 });
  } catch (error) {
    if (error instanceof JobCancelled) update({ status: "CANCELLED", error: null });
    else update({ status: "FAILED", error: { message: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}
