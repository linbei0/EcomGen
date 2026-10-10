import archiver from "archiver";
import type { JobRecord, ProjectRecord } from "@ecomgen/core";
import type { WorkerContext } from "./context.js";
import { safeName } from "./context.js";

export async function executeExport(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, storage, events, updateJob, throwIfCancelled, projectFor } = ctx;
  throwIfCancelled(job);
  const project = projectFor(job); const outputIds = Array.isArray(job.input.outputIds) ? job.input.outputIds.filter((value): value is string => typeof value === "string") : undefined;
  const outputs = repository.listOutputs(project.id).filter((output) => !outputIds || outputIds.includes(output.id)); if (outputs.length === 0) throw new Error("No outputs are available for export");
  const exportRecord = repository.getExportByJobId(job.id); await updateJob(job, { progress: 25 });
  // manifest 让导出包可追溯到事实、模板、Prompt、审核结果和输出内容 hash。
  const manifest = { version: 1, generatedAt: new Date().toISOString(), project: { id: project.id, name: project.name, platforms: project.platformTargets, category: project.category, imageResolution: project.imageResolution, imageAspectRatio: project.imageAspectRatio }, facts: { verified: project.verifiedFacts, prohibited: project.prohibitedClaims, brandGuidelines: project.brandGuidelines }, storyboard: outputs.map((output) => { const item = repository.getStoryboardItem(output.storyboardItemId); return { outputId: output.id, jobId: output.jobId, assetType: item?.assetType ?? null, displayName: item?.displayName ?? null, templateVariant: item?.templateVariant ?? null, mode: item?.mode ?? null, candidateIndex: output.candidateIndex, generationSnapshot: output.generationSnapshot, prompt: item?.compiledPrompt ?? null, sha256: output.hash }; }) };
  // 流式导出：图片从磁盘直接进 archiver 管道，内存峰值从"全部图片 + 整个 ZIP"降为常数级；
  // zlib level 1——产物是已压缩的 PNG/JPEG，level 9 几乎无压缩收益，纯耗 CPU。
  const stored = await storage.putExportStream(project.id, async (destination) => {
    const zip = archiver("zip", { zlib: { level: 1 } });
    const settled = new Promise<void>((resolve, reject) => {
      destination.once("close", () => resolve());
      destination.once("error", reject);
      zip.once("error", reject);
    });
    zip.pipe(destination);
    outputs.forEach((output, index) => zip.file(storage.absolute(output.storagePath), { name: exportFileName(ctx, project, output, index) }));
    zip.append(Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), { name: "manifest.json" });
    await zip.finalize();
    await settled;
  });
  const target = exportRecord ?? repository.createExport({ projectId: project.id, jobId: job.id, status: "QUEUED", storagePath: null }); const updated = repository.updateExport(target.id, { status: "SUCCEEDED", storagePath: stored.path }); await events.publish(project.id, "export.updated", { export: updated });
}

function exportFileName(ctx: WorkerContext, project: ProjectRecord, output: { storyboardItemId: string; storagePath: string }, index: number): string { const item = ctx.repository.getStoryboardItem(output.storyboardItemId); const extension = output.storagePath.slice(output.storagePath.lastIndexOf(".")); return `${safeName(project.name)}_${String(index + 1).padStart(2, "0")}_${safeName(item?.assetType ?? "image")}${extension}`; }
