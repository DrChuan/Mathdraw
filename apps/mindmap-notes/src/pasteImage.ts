import type { ClipboardEvent } from "react";
const pending = new Set<Promise<void>>();
/** Images live in the document, so existing atomic saves, conflict copies and COS sync include them. */
export function pasteImage(
  event: ClipboardEvent<HTMLTextAreaElement>,
  change: (text: string) => void,
  error: (text: string) => void = () => {},
) {
  const file = [...event.clipboardData.items]
    .find(
      (i) => i.kind === "file" && /^image\/(png|jpeg|webp|gif)$/.test(i.type),
    )
    ?.getAsFile();
  if (!file) return false;
  event.preventDefault();
  event.stopPropagation();
  const input = event.currentTarget;
  const task = (async () => {
    if (file.size > 2 * 1024 * 1024)
      throw new Error("图片不能超过 2 MiB，请先缩小图片");
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取剪贴板图片"));
      reader.readAsDataURL(file);
    });
    // Never inject a delayed result into a different note or node.
    if (!input.isConnected) return;
    const value = input.value,
      start = input.selectionStart,
      end = input.selectionEnd;
    const insertion = `\n![图片](${data})\n`;
    const next = value.slice(0, start) + insertion + value.slice(end);
    if (new TextEncoder().encode(next).length > 7 * 1024 * 1024)
      throw new Error("图片插入后内容过大，请缩小图片");
    input.value = next;
    change(next);
    requestAnimationFrame(() => {
      if (input.isConnected) {
        input.focus();
        input.setSelectionRange(
          start + insertion.length,
          start + insertion.length,
        );
      }
    });
  })()
    .catch((e) => error(String(e instanceof Error ? e.message : e)))
    .finally(() => pending.delete(task));
  pending.add(task);
  return true;
}
export const hasImagePastes = () => pending.size > 0;
export async function finishImagePastes() {
  await Promise.all([...pending]);
}
export const safeEmbeddedImage = (url: string) =>
  /^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(url) &&
  url.length < 3 * 1024 * 1024;
