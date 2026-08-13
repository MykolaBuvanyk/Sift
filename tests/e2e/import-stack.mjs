import { createWriteStream, createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

const apiUrl = new URL(process.env.SIFT_E2E_API_URL ?? "http://127.0.0.1:3001");
const token = process.env.AUTH_BEARER_TOKEN ?? "replace-with-at-least-32-random-characters";
const rows = positiveInteger(process.env.SIFT_E2E_ROWS ?? "250", "SIFT_E2E_ROWS");
const invalidEvery = nonnegativeInteger(process.env.SIFT_E2E_INVALID_EVERY ?? "17", "SIFT_E2E_INVALID_EVERY");
const timeoutMs = positiveInteger(process.env.SIFT_E2E_TIMEOUT_MS ?? "120000", "SIFT_E2E_TIMEOUT_MS");
const crashWorker = process.env.SIFT_E2E_CRASH_WORKER === "1";
const composeProject = process.env.SIFT_E2E_COMPOSE_PROJECT ?? "sift-ci";
const composeEnvFile = process.env.SIFT_E2E_COMPOSE_ENV_FILE ?? ".env.example";
const sourcePath = join(tmpdir(), `sift-stack-e2e-${randomUUID()}.ndjson`);
const idempotencyKey = `stack-e2e-${randomUUID()}`;

try {
  const expected = await generateSource(sourcePath, rows, invalidEvery);
  const declaredSizeBytes = (await stat(sourcePath)).size;
  const metadata = {
    idempotency_key: idempotencyKey,
    format: "ndjson",
    filename: "generated.ndjson",
    declared_size_bytes: declaredSizeBytes,
  };

  const created = await apiJson("/imports", { method: "POST", body: metadata });
  assert(created.upload_required === true && typeof created.upload_url === "string", "Initial create must require upload.");

  const replayBeforeUpload = await apiJson("/imports", { method: "POST", body: metadata });
  assert(replayBeforeUpload.job_id === created.job_id, "Idempotency replay created another job before upload.");

  const upload = await fetch(created.upload_url, {
    method: created.upload_method,
    headers: {
      ...created.upload_headers,
      "Content-Length": String(declaredSizeBytes),
    },
    body: createReadStream(sourcePath),
    duplex: "half",
  });
  assert(upload.ok, `Upload failed with HTTP ${upload.status}.`);

  await apiJson(`/imports/${created.job_id}/finalize`, { method: "POST" });
  const crashCheckpoint = crashWorker
    ? await crashAndRestartWorker(created.job_id, declaredSizeBytes, timeoutMs)
    : null;
  const completed = await waitForCompletion(created.job_id, timeoutMs);
  assert(completed.status === "completed", `Import ended with status ${completed.status}.`);
  assert(completed.total_bytes === declaredSizeBytes, "Final byte count differs from the generated source.");
  assert(completed.processed_bytes === declaredSizeBytes, "Worker did not reach the final byte checkpoint.");
  assert(completed.imported_count === expected.imported, "Imported counter is incorrect.");
  assert(completed.failed_count === expected.failed, "Failed counter is incorrect.");
  assert(completed.duplicate_count === 0, "Generated source unexpectedly produced duplicates.");
  assert(
    completed.last_line_number
      === completed.imported_count + completed.failed_count + completed.duplicate_count,
    "Counters do not reconcile with the line watermark.",
  );

  const reportRows = await countNdjsonResponse(`/imports/${created.job_id}/errors`);
  assert(reportRows === expected.failed, "Streaming error report row count is incorrect.");

  const replayAfterCompletion = await apiJson("/imports", { method: "POST", body: metadata });
  assert(replayAfterCompletion.job_id === created.job_id, "Completed idempotency replay created another job.");
  assert(replayAfterCompletion.status === "completed", "Completed idempotency replay changed job status.");
  assert(replayAfterCompletion.upload_required === false, "Completed idempotency replay requested another upload.");

  const contentReplayMetadata = {
    ...metadata,
    idempotency_key: `${idempotencyKey}-same-content`,
  };
  const contentReplay = await apiJson("/imports", { method: "POST", body: contentReplayMetadata });
  assert(contentReplay.job_id !== created.job_id, "A new key should reserve a distinct job before hashing.");
  const contentReplayUpload = await fetch(contentReplay.upload_url, {
    method: contentReplay.upload_method,
    headers: {
      ...contentReplay.upload_headers,
      "Content-Length": String(declaredSizeBytes),
    },
    body: createReadStream(sourcePath),
    duplex: "half",
  });
  assert(contentReplayUpload.ok, `Content replay upload failed with HTTP ${contentReplayUpload.status}.`);
  const canonicalFinalize = await apiJson(`/imports/${contentReplay.job_id}/finalize`, { method: "POST" });
  assert(canonicalFinalize.job_id === created.job_id, "Content hash replay did not resolve to the canonical job.");

  process.stdout.write(`${JSON.stringify({
    rows,
    imported: completed.imported_count,
    failed: completed.failed_count,
    duplicates: completed.duplicate_count,
    processedBytes: completed.processed_bytes,
    crashCheckpoint,
    idempotentJobId: created.job_id,
  })}\n`);
} finally {
  await unlink(sourcePath).catch((error) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  });
}

async function generateSource(path, count, badEvery) {
  const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
  let imported = 0;
  let failed = 0;

  try {
    for (let index = 1; index <= count; index += 1) {
      const invalid = badEvery > 0 && index % badEvery === 0;
      const row = invalid
        ? { email: "invalid", full_name: "" }
        : {
          email: `stack-${idempotencyKey}-${index}@example.com`,
          full_name: `Generated Contact ${index}`,
          tags: ["e2e", "generated"],
        };
      if (invalid) {
        failed += 1;
      } else {
        imported += 1;
      }
      if (!output.write(`${JSON.stringify(row)}\n`)) {
        await once(output, "drain");
      }
    }
    output.end();
    await once(output, "close");
  } catch (error) {
    output.destroy();
    throw error;
  }

  return { imported, failed };
}

async function waitForCompletion(jobId, maximumWaitMs) {
  const deadline = Date.now() + maximumWaitMs;
  while (Date.now() < deadline) {
    const job = await apiJson(`/imports/${jobId}`, { method: "GET" });
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Import did not finish within ${maximumWaitMs} ms.`);
}

async function crashAndRestartWorker(jobId, totalBytes, maximumWaitMs) {
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(composeProject), "Invalid Compose project name.");
  const checkpoint = await waitForCommittedCheckpoint(jobId, totalBytes, maximumWaitMs);
  const { stdout } = await executeFile("docker", [
    "compose",
    "--env-file",
    composeEnvFile,
    "-p",
    composeProject,
    "ps",
    "-q",
    "worker",
  ]);
  const containerId = stdout.trim();
  assert(/^[a-f0-9]{12,64}$/.test(containerId), "Could not resolve the worker container ID.");

  let restartPolicyChanged = false;
  try {
    await executeFile("docker", ["update", "--restart=no", containerId]);
    restartPolicyChanged = true;
    await executeFile("docker", ["kill", "--signal=KILL", containerId]);

    const afterCrash = await apiJson(`/imports/${jobId}`, { method: "GET" });
    assert(afterCrash.status === "running", "Killed worker did not leave a leased running job.");
    assert(afterCrash.processed_bytes >= checkpoint, "Crash rolled back an already committed checkpoint.");
    assert(afterCrash.processed_bytes < totalBytes, "Worker finished before the crash was delivered.");
    return afterCrash.processed_bytes;
  } finally {
    if (restartPolicyChanged) {
      await executeFile("docker", ["update", "--restart=unless-stopped", containerId]);
      await executeFile("docker", ["start", containerId]);
    }
  }
}

async function waitForCommittedCheckpoint(jobId, totalBytes, maximumWaitMs) {
  const deadline = Date.now() + maximumWaitMs;
  while (Date.now() < deadline) {
    const job = await apiJson(`/imports/${jobId}`, { method: "GET" });
    if (job.processed_bytes > 0 && job.processed_bytes < totalBytes) {
      return job.processed_bytes;
    }
    assert(job.status !== "failed", "Import failed before the crash checkpoint.");
    assert(job.status !== "completed", "Import completed before a mid-stream crash could be injected.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Import did not expose a committed mid-stream checkpoint within ${maximumWaitMs} ms.`);
}

async function apiJson(path, options) {
  const response = await fetch(new URL(path, apiUrl), {
    method: options.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => null);
  assert(response.ok, `API ${options.method} ${path} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function countNdjsonResponse(path) {
  const response = await fetch(new URL(path, apiUrl), {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(response.ok && response.body, `Error report failed with HTTP ${response.status}.`);
  const decoder = new TextDecoder();
  let remainder = "";
  let count = 0;
  for await (const chunk of response.body) {
    remainder += decoder.decode(chunk, { stream: true });
    const lines = remainder.split("\n");
    remainder = lines.pop() ?? "";
    count += lines.filter((line) => line.length > 0).length;
  }
  remainder += decoder.decode();
  return count + (remainder.length > 0 ? 1 : 0);
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function nonnegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
