import { writePsd } from "ag-psd";

// psd 文档结构与请求相同：{width, height, children?, compositeImageData?}
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null;
  postMessage(message: { buffer?: ArrayBuffer; error?: string }, transfer?: Transferable[]): void;
};

// ag-psd 的 imageData 路径不需要 canvas；结果 ArrayBuffer 以 transferable 回传，避免主线程拷贝
ctx.onmessage = (event) => {
  try {
    const buffer = writePsd(event.data as unknown as Parameters<typeof writePsd>[0]);
    ctx.postMessage({ buffer }, [buffer]);
  } catch (cause) {
    ctx.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};
