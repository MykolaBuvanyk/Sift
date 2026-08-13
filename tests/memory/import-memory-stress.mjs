import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseCsvBatches } from "../../dist/worker/imports/csv-parser.js";
import { parseNdjsonBatches } from "../../dist/worker/imports/ndjson-parser.js";

const rows = parsePositiveInteger(process.env.IMPORT_STRESS_ROWS ?? "1000000", "IMPORT_STRESS_ROWS");
const format = process.env.IMPORT_STRESS_FORMAT ?? "both";
const maxRssDeltaMb = parsePositiveInteger(
  process.env.IMPORT_STRESS_MAX_RSS_DELTA_MB ?? "176",
  "IMPORT_STRESS_MAX_RSS_DELTA_MB",
);

if (!["both", "csv", "ndjson"].includes(format)) {
  throw new Error("IMPORT_STRESS_FORMAT must be both, csv, or ndjson.");
}

if (format === "both") {
  for (const childFormat of ["ndjson", "csv"]) {
    const result = spawnSync(process.execPath, [
      "--expose-gc",
      "--max-old-space-size=192",
      fileURLToPath(import.meta.url),
    ], {
      env: { ...process.env, IMPORT_STRESS_FORMAT: childFormat },
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`${childFormat} memory stress child failed.`);
    }
  }
} else {
  await run(format);
}

async function run(currentFormat) {
  forceGarbageCollection();
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  let processedRows = 0;
  const source = Readable.from(generateRows(currentFormat, rows));
  const batches = currentFormat === "csv"
    ? parseCsvBatches(source, { batchSize: 500, maxRecordBytes: 2_048 })
    : parseNdjsonBatches(source, { batchSize: 500, maxLineBytes: 2_048 });

  for await (const batch of batches) {
    processedRows += batch.rows.length;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }

  const deltaMb = (peakRss - baselineRss) / 1024 / 1024;
  if (processedRows !== rows) {
    throw new Error(`${currentFormat} processed ${processedRows} rows instead of ${rows}.`);
  }
  if (deltaMb > maxRssDeltaMb) {
    throw new Error(`${currentFormat} RSS grew by ${deltaMb.toFixed(1)} MB; limit is ${maxRssDeltaMb} MB.`);
  }
  process.stdout.write(`${JSON.stringify({
    format: currentFormat,
    rows: processedRows,
    peakRssDeltaMb: Number(deltaMb.toFixed(1)),
  })}\n`);
}

async function* generateRows(currentFormat, count) {
  const chunkSize = 1_000;
  if (currentFormat === "csv") {
    yield Buffer.from("email,full_name,phone,tags\n");
  }

  for (let start = 1; start <= count; start += chunkSize) {
    const end = Math.min(count, start + chunkSize - 1);
    let chunk = "";
    for (let row = start; row <= end; row += 1) {
      chunk += currentFormat === "csv"
        ? `stress-${row}@example.com,Stress ${row},,generated|stress\n`
        : `${JSON.stringify({
          email: `stress-${row}@example.com`,
          full_name: `Stress ${row}`,
          tags: ["generated", "stress"],
        })}\n`;
    }
    yield Buffer.from(chunk);
  }
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function forceGarbageCollection() {
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }
}
