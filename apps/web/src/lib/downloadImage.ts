/** 单图下载：原图经 fetch 转 blob 再触发保存；跨域直链的 download 属性会被浏览器忽略。 */
export async function downloadOriginal(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

const UNSAFE_FILENAME = /[\\/:*?"<>|]/g;

/**
 * 下载文件名：优先分镜展示名，扩展名取 storagePath / URL 路径末段，缺省 .png。
 * 输出文件的服务地址不带扩展名，不能只看 URL。
 */
export function outputFileName(
  output: { id: string; storagePath?: string | null },
  displayName: string,
): string {
  const base = (displayName.trim() || output.id).replace(UNSAFE_FILENAME, " ").trim() || output.id;
  const source = output.storagePath ?? "";
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(source);
  return `${base}.${match?.[1]?.toLowerCase() ?? "png"}`;
}
