import type { ImportFormat, ImportJobStatus } from "@sift/contracts";

export const MAX_IMPORT_BYTES = 1_000_000_000;

export function inferImportFormat(filename: string): ImportFormat {
  return filename.toLowerCase().endsWith(".csv") ? "csv" : "ndjson";
}

export function validateImportFile(file: File): string | null {
  if (file.size < 1) {
    return "Файл порожній.";
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return "Файл перевищує локальний ліміт 1 GB.";
  }
  if (file.name.trim().length > 255) {
    return "Назва файла задовга.";
  }
  if (!/\.(csv|ndjson|jsonl)$/i.test(file.name)) {
    return "Оберіть файл .ndjson, .jsonl або .csv.";
  }
  return null;
}

export function isTerminalStatus(status: ImportJobStatus): boolean {
  return status === "completed" || status === "failed";
}

export function formatBytes(value: number): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}
