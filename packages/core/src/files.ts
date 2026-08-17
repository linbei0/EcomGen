import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export class LocalAssetStore {
  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  public async initialize(): Promise<void> {
    await Promise.all(["assets", "outputs", "exports", "tmp"].map((part) => mkdir(join(this.root, part), { recursive: true })));
  }

  public async putAsset(projectId: string, originalName: string, content: Buffer): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const extension = this.safeExtension(originalName);
    const relativePath = join("assets", projectId, `${randomUUID()}-${hash.slice(0, 12)}${extension}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  public async putOutput(projectId: string, content: Buffer, extension = ".png"): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = join("outputs", projectId, `${randomUUID()}-${hash.slice(0, 12)}${this.safeExtension(extension)}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  public async putExport(projectId: string, content: Buffer, extension = ".zip"): Promise<{ path: string; hash: string }> {
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = join("exports", projectId, `${randomUUID()}-${hash.slice(0, 12)}${this.safeExtension(extension)}`);
    await this.write(relativePath, content);
    return { path: relativePath, hash };
  }

  public async read(relativePath: string): Promise<Buffer> {
    return readFile(this.absolute(relativePath));
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
