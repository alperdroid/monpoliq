/**
 * Client-side CSV download helper.
 * Follows the deliverFile pattern: blob built before the click, share-sheet
 * fallback on touch devices (iOS "Save to Files"), revoke after a delay.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function deliverFile(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
    }
  }
  downloadBlob(blob, filename);
}

/** Escape a single CSV field: wrap in quotes when it contains , " or newline. */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: (string | number | null | undefined)[][], headers: string[]): string {
  return [headers, ...rows].map(r => r.map(csvField).join(",")).join("\n");
}

export function downloadCsv(rows: (string | number | null | undefined)[][], headers: string[], filename: string) {
  const blob = new Blob([buildCsv(rows, headers)], { type: "text/csv;charset=utf-8" });
  deliverFile(blob, filename);
}
