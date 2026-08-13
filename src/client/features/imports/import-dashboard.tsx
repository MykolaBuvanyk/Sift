"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportFormat, ImportJob } from "@sift/contracts";
import { useState } from "react";

import { QueryProvider } from "@/client/app/query-provider";
import {
  createImport,
  finalizeImport,
  getImport,
  retryImport,
  SiftApiError,
  uploadImportSource,
} from "@/client/shared/api/sift-api-client";
import {
  formatBytes,
  inferImportFormat,
  isTerminalStatus,
  validateImportFile,
} from "./import-dashboard.model";

type SelectedImport = {
  file: File;
  format: ImportFormat;
  idempotencyKey: string;
};

type UploadPhase = "idle" | "reserving" | "uploading" | "finalizing" | "processing";

const phaseLabels: Record<Exclude<UploadPhase, "idle">, string> = {
  reserving: "Створюємо імпорт",
  uploading: "Завантажуємо файл",
  finalizing: "Перевіряємо файл",
  processing: "Обробляємо рядки",
};

export function ImportDashboard() {
  return (
    <QueryProvider>
      <ImportWorkspace />
    </QueryProvider>
  );
}

function ImportWorkspace() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<SelectedImport | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadPercent, setUploadPercent] = useState(0);

  const importQuery = useQuery({
    queryKey: ["import", jobId],
    queryFn: ({ signal }) => getImport(jobId as string, signal),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const job = query.state.data;
      return job && isTerminalStatus(job.status) ? false : 1_500;
    },
    refetchIntervalInBackground: false,
  });

  const startImport = useMutation({
    mutationFn: async (input: SelectedImport) => {
      setPhase("reserving");
      setUploadPercent(0);
      const reservation = await createImport({
        idempotency_key: input.idempotencyKey,
        format: input.format,
        filename: input.file.name,
        declared_size_bytes: input.file.size,
      });
      setJobId(reservation.job_id);

      setPhase("uploading");
      await uploadImportSource(reservation, input.file, setUploadPercent);
      setPhase("finalizing");
      const finalized = await finalizeImport(reservation.job_id);
      setJobId(finalized.job_id);
      setPhase("processing");
      await queryClient.invalidateQueries({ queryKey: ["import", finalized.job_id] });
      return finalized.job_id;
    },
  });

  const retryJob = useMutation({
    mutationFn: (id: string) => retryImport(id),
    onSuccess: async ({ job }) => {
      setPhase("processing");
      queryClient.setQueryData(["import", job.id], job);
      await queryClient.invalidateQueries({ queryKey: ["import", job.id] });
    },
  });

  const job = importQuery.data;
  const visibleJob = job && (phase === "processing" || isTerminalStatus(job.status))
    ? job
    : undefined;
  const visibleError = startImport.error ?? retryJob.error ?? importQuery.error;
  const busy = startImport.isPending || retryJob.isPending;

  function selectFile(file: File | undefined): void {
    startImport.reset();
    retryJob.reset();
    setJobId(null);
    setPhase("idle");
    setUploadPercent(0);
    if (!file) {
      setSelected(null);
      setSelectionError(null);
      return;
    }
    const error = validateImportFile(file);
    setSelectionError(error);
    setSelected(error ? null : {
      file,
      format: inferImportFormat(file.name),
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function reset(): void {
    setSelected(null);
    setSelectionError(null);
    setJobId(null);
    setPhase("idle");
    setUploadPercent(0);
    startImport.reset();
    retryJob.reset();
  }

  return (
    <div className="import-shell">
      <header className="import-hero">
        <div>
          <p className="eyebrow">Sift / Imports</p>
          <h1>Імпорт контактів без блокування браузера</h1>
          <p className="hero-copy">
            Завантажте NDJSON або CSV. Файл піде напряму в object storage, а worker
            обробить його пакетами з checkpoint і відновленням після збою.
          </p>
        </div>
        <span className="runtime-badge">streaming pipeline</span>
      </header>

      <div className="dashboard-grid">
        <section className="panel upload-panel" aria-labelledby="upload-title">
          <div className="panel-heading">
            <div>
              <p className="section-index">01</p>
              <h2 id="upload-title">Новий імпорт</h2>
            </div>
            <span className="file-limit">до 1 GB</span>
          </div>

          <label className="file-drop">
            <input
              type="file"
              accept=".ndjson,.jsonl,.csv,application/x-ndjson,text/csv"
              disabled={busy}
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            <span className="drop-icon" aria-hidden="true">↗</span>
            <strong>{selected ? selected.file.name : "Оберіть файл"}</strong>
            <span>{selected ? formatBytes(selected.file.size) : ".ndjson, .jsonl або .csv"}</span>
          </label>

          {selectionError ? <p className="inline-error" role="alert">{selectionError}</p> : null}

          {selected ? (
            <div className="format-row">
              <span>Формат</span>
              <div className="segmented" role="group" aria-label="Формат імпорту">
                {(["ndjson", "csv"] as const).map((format) => (
                  <button
                    className={selected.format === format ? "active" : ""}
                    disabled={busy}
                    key={format}
                    type="button"
                    onClick={() => setSelected((current) => current ? { ...current, format } : null)}
                  >
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <button
            className="primary-button"
            type="button"
            disabled={!selected || busy}
            onClick={() => selected && startImport.mutate(selected)}
          >
            {startImport.isPending ? "Імпорт запускається…" : "Запустити імпорт"}
          </button>
          <p className="security-note">
            Client-side перевірка допомагає UX; остаточні обмеження повторно перевіряє API.
          </p>
        </section>

        <section className="panel progress-panel" aria-labelledby="progress-title">
          <div className="panel-heading">
            <div>
              <p className="section-index">02</p>
              <h2 id="progress-title">Стан виконання</h2>
            </div>
            <StatusBadge job={job} phase={phase} />
          </div>

          {visibleJob ? (
            <JobProgress
              job={visibleJob}
              retrying={retryJob.isPending}
              onRetry={() => retryJob.mutate(visibleJob.id)}
              onReset={reset}
            />
          ) : (
            <UploadProgress phase={phase} percent={uploadPercent} />
          )}

          {visibleError ? <ErrorNotice error={visibleError} /> : null}
        </section>
      </div>
    </div>
  );
}

function UploadProgress({ phase, percent }: Readonly<{ phase: UploadPhase; percent: number }>) {
  if (phase === "idle") {
    return (
      <div className="empty-state">
        <span aria-hidden="true">◎</span>
        <p>Прогрес з’явиться після створення import job.</p>
      </div>
    );
  }
  return (
    <div className="phase-state" aria-live="polite">
      <p>{phase === "uploading" ? `${phaseLabels[phase]} — ${percent}%` : phaseLabels[phase]}</p>
      <div className="progress-track">
        <span style={{ width: phase === "uploading" ? `${percent}%` : "18%" }} />
      </div>
    </div>
  );
}

function JobProgress({
  job,
  onReset,
  onRetry,
  retrying,
}: Readonly<{
  job: ImportJob;
  onReset: () => void;
  onRetry: () => void;
  retrying: boolean;
}>) {
  const terminal = isTerminalStatus(job.status);
  return (
    <div className="job-progress" aria-live="polite">
      <div className="progress-summary">
        <strong>{job.progress_percent.toFixed(2)}%</strong>
        <span>{formatBytes(job.processed_bytes)} / {formatBytes(job.total_bytes)}</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Прогрес імпорту"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={job.progress_percent}
      >
        <span style={{ width: `${job.progress_percent}%` }} />
      </div>
      <div className="metric-grid">
        <Metric label="Імпортовано" value={job.imported_count} tone="success" />
        <Metric label="Дублікати" value={job.duplicate_count} tone="neutral" />
        <Metric label="Помилки" value={job.failed_count} tone="danger" />
        <Metric label="Рядок" value={job.last_line_number} tone="neutral" />
      </div>

      {job.status === "completed" && job.failed_count > 0 ? (
        <p className="partial-note">Імпорт завершено частково: валідні рядки збережено, помилки доступні у звіті.</p>
      ) : null}

      <div className="job-actions">
        {job.status === "failed" ? (
          <button className="secondary-button" type="button" disabled={retrying} onClick={onRetry}>
            {retrying ? "Повторюємо…" : "Повторити з checkpoint"}
          </button>
        ) : null}
        {terminal ? (
          <a className="secondary-link" href={`/api/imports/${job.id}/errors`}>
            Завантажити звіт
          </a>
        ) : null}
        <button className="text-button" type="button" onClick={onReset}>Новий імпорт</button>
      </div>
    </div>
  );
}

function Metric({ label, tone, value }: Readonly<{
  label: string;
  tone: "danger" | "neutral" | "success";
  value: number;
}>) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString("uk-UA")}</strong>
    </div>
  );
}

function StatusBadge({ job, phase }: Readonly<{ job?: ImportJob; phase: UploadPhase }>) {
  const status = job?.status ?? phase;
  const label = job?.status === "completed"
    ? "Завершено"
    : job?.status === "failed"
      ? "Помилка"
      : job?.status === "running"
        ? "В роботі"
        : phase === "idle"
          ? "Очікує"
          : "Підготовка";
  return <span className={`status-badge status-${status}`}>{label}</span>;
}

function ErrorNotice({ error }: Readonly<{ error: Error }>) {
  const code = error instanceof SiftApiError ? error.code : "DASHBOARD.UNEXPECTED_ERROR";
  const traceId = error instanceof SiftApiError ? error.traceId : undefined;
  return (
    <div className="error-notice" role="alert">
      <strong>Не вдалося продовжити імпорт</strong>
      <p>{error.message}</p>
      <small>{code}{traceId ? ` · ${traceId}` : ""}</small>
    </div>
  );
}
