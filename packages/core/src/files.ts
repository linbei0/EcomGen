import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export class LocalAssetStore {
  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  public async initialize(): Promise<void> {
    await Promise.all(["assets", "outputs", "exports", "edits", "layers", "thumbs", "tmp", "suite-forge"].map((part) => mkdir(join(this.root, part), { recursive: true })));
  }

  public async putAsset(projectId: string, originalName: string, content: Buffer): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const extension = this.safeExtension(originalName);
    const relativePath = join("assets", projectId, `${randomUUID()}-${hash.slice(0, 12)}${extension}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  public async putOutput(projectId: string, content: Buffer, extension = ".png", idempotencyKey?: string): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const name = idempotencyKey
      ? `${createHash("sha256").update(idempotencyKey).digest("hex")}${this.safeExtension(extension)}`
      : `${randomUUID()}-${hash.slice(0, 12)}${this.safeExtension(extension)}`;
    const relativePath = join("outputs", projectId, name);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  public async putExport(projectId: string, content: Buffer, extension = ".zip"): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = join("exports", projectId, `${randomUUID()}-${hash.slice(0, 12)}${this.safeExtension(extension)}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  public async putEditArtifact(projectId: string, sessionId: string, turnId: string, name: string, content: Buffer): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = join("edits", projectId, sessionId, turnId, `${name}-${hash.slice(0, 12)}${this.safeExtension(name)}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  public async putEditReferenceAsset(projectId: string, sessionId: string, name: string, content: Buffer): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = join("edits", projectId, sessionId, "references", `${randomUUID()}-${hash.slice(0, 12)}${this.safeExtension(name)}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  /** 分层导出产物（元素图层 PNG、带孔洞背景层与 PSD）；按 layerExportId 聚合，随项目删除一并清理。 */
  public async putLayerArtifact(projectId: string, layerExportId: string, name: string, content: Buffer, extension = ".png"): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = join("layers", projectId, layerExportId, `${name}-${hash.slice(0, 12)}${this.safeExtension(extension)}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  /** 套图反推来源图：不入项目，按 job 聚合到 suite-forge 命名空间，任务失败时随清理一并删除。 */
  public async putSuiteForgeSource(jobId: string, originalName: string, content: Buffer): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = join("suite-forge", jobId, `${randomUUID()}-${hash.slice(0, 12)}${this.safeExtension(originalName)}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  /** 模特参考脸：每模特至多一张身份基准图，按 model 聚合；重复上传时旧文件由调用方覆盖语义（路径随 hash 变化，孤儿文件可容忍）。 */
  public async putModelReferenceFace(modelId: string, originalName: string, content: Buffer): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = join("models", modelId, `reference-${hash.slice(0, 12)}${this.safeExtension(originalName)}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  /** 模选定妆照：不入项目，按模特与 job 聚合；文件随模特删除级联清理。 */
  public async putModelPortrait(modelId: string, jobId: string, content: Buffer): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = join("models", modelId, "casts", jobId, `${randomUUID()}-${hash.slice(0, 12)}.png`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  /** 缩略图按内容 hash 寻址：同一张图跨项目共享一份，删除项目不影响派生缓存。 */
  public thumbnailPath(hash: string): string {
    return join("thumbs", `${hash}.webp`);
  }

  public async putThumbnail(hash: string, content: Buffer): Promise<string> {
    const relativePath = this.thumbnailPath(hash);
    await this.write(relativePath, content);
    return relativePath;
  }

  public async hasThumbnail(hash: string): Promise<boolean> {
    return this.exists(this.thumbnailPath(hash));
  }

  public async read(relativePath: string): Promise<Buffer> {
    return readFile(this.absolute(relativePath));
  }

  public stream(relativePath: string) {
    return createReadStream(this.absolute(relativePath));
  }

  public async size(relativePath: string): Promise<number> {
    return (await stat(this.absolute(relativePath))).size;
  }

  public async exists(relativePath: string): Promise<boolean> {
    try {
      await stat(this.absolute(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  public async delete(relativePath: string): Promise<void> {
    await unlink(this.absolute(relativePath)).catch(() => undefined);
  }

  /**
   * 永久删除项目的全部本地产物。
   *
   * projectId 来自 URL 参数并直接参与拼路径，是路径穿越的高危入口：`../`、反斜杠或
   * 绝对路径都会改变删除目标，而 `rm recursive + force` 会把误伤静默放大。这里强制
   * projectId 为单段目录名，并要求解析后的目标位于对应资源目录（<root>/<part>/）之下。
   */
  public async deleteProject(projectId: string): Promise<void> {
    if (
      projectId.length === 0 ||
      projectId.includes("/") ||
      projectId.includes("\\") ||
      projectId.includes("..") ||
      isAbsolute(projectId)
    ) {
      throw new Error("Project id must be a single path segment");
    }
    await Promise.all(
      ["assets", "outputs", "exports", "edits", "layers"].map((part) => {
        const target = this.absolute(join(part, projectId));
        const pathFromPart = relative(this.absolute(part), target);
        if (pathFromPart.startsWith("..") || isAbsolute(pathFromPart)) throw new Error("Asset path escapes storage root");
        return rm(target, { recursive: true, force: true });
      }),
    );
  }

  public absolute(relativePath: string): string {
    if (isAbsolute(relativePath)) throw new Error("Asset path must be relative to the storage root");
    const absolute = resolve(this.root, relativePath);
    const pathFromRoot = relative(this.root, absolute);
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error("Asset path escapes storage root");
    return absolute;
  }

  private async write(relativePath: string, content: Buffer): Promise<void> {
    const destination = this.absolute(relativePath);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = join(this.root, "tmp", randomUUID());
    await writeFile(temporary, content);
    await rename(temporary, destination);
  }

  private safeExtension(value: string): string {
    const match = /\.[a-zA-Z0-9]{1,8}$/.exec(value);
    return match ? match[0].toLowerCase() : "";
  }
}
