/** File download helpers. No Chrome APIs. */

export function mermaidFilename(source: string, ext: string): string {
  const line = source.split(/\r?\n/).find((row) => {
    const t = row.trim();
    return t && !t.startsWith("%%");
  });
  const slug = (line ?? "diagram")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "diagram"}.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, type = "text/plain") {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

export async function svgElementToPngBlob(svg: Element): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = svg.getBoundingClientRect();
  const vb = clone.viewBox?.baseVal;
  const width = Math.max(1, Math.ceil(box.width || svg.clientWidth || vb?.width || 800));
  const height = Math.max(1, Math.ceil(box.height || svg.clientHeight || vb?.height || 400));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#FAF9F5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) throw new Error("png");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
