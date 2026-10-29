"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import type { ReportReason } from "@/domain";
import type {
  AdminReport,
  AdminReportListResponse,
  ModerationAction,
  ReportState,
} from "@/server/admin/contracts";

const REASON_OPTIONS: readonly { value: ReportReason; label: string }[] = [
  { value: "spam", label: "宣伝・スパム" },
  { value: "harassment", label: "嫌がらせ" },
  { value: "personal_information", label: "個人情報" },
  { value: "sexual_content", label: "性的な内容" },
  { value: "illegal_content", label: "違法行為に関する内容" },
  { value: "other", label: "その他" },
];

const STATE_OPTIONS: readonly { value: ReportState; label: string }[] = [
  { value: "open", label: "未対応" },
  { value: "resolved", label: "対応済み" },
  { value: "dismissed", label: "対応不要" },
];

const DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "AdminRequestError";
  }
}

type ApiErrorPayload = {
  error?: { message?: unknown; retryAfterSeconds?: unknown };
};

type RetryEntry = { fingerprint: string; idempotencyKey: string };

function errorMessage(payload: unknown, status: number): string {
  const candidate = payload as ApiErrorPayload | null;
  if (typeof candidate?.error?.message === "string") {
    const retry = candidate.error.retryAfterSeconds;
    return typeof retry === "number"
      ? `${candidate.error.message} ${retry}秒後に再試行してください。`
      : candidate.error.message;
  }
  if (status === 401) return "管理者として認証してください。";
  if (status === 403)
    return "管理者権限、確認済みメール、MFA認証を確認してください。";
  return "管理APIから応答を取得できませんでした。";
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? DATE_FORMATTER.format(parsed)
    : "日時を確認できません";
}

function reasonLabel(reason: ReportReason): string {
  return (
    REASON_OPTIONS.find((option) => option.value === reason)?.label ?? reason
  );
}

function stateLabel(state: ReportState): string {
  return STATE_OPTIONS.find((option) => option.value === state)?.label ?? state;
}

function moderationConfirmation(action: ModerationAction): string {
  if (action === "hide") {
    return "この絵馬を公開経路から非表示にします。続けますか？";
  }
  if (action === "restore") {
    return "この絵馬を現在の公開設定で再公開します。続けますか？";
  }
  return "この絵馬の本文を抹消します。削除後は復元できません。続けますか？";
}

type ReportCardProps = {
  report: AdminReport;
  busyKey: string | null;
  onModerate: (
    report: AdminReport,
    action: ModerationAction,
    reason: ReportReason,
  ) => void;
  onUpdateReport: (
    report: AdminReport,
    state: "resolved" | "dismissed",
  ) => void;
};

function AdminReportCard({
  report,
  busyKey,
  onModerate,
  onUpdateReport,
}: ReportCardProps) {
  const [moderationReason, setModerationReason] = useState<ReportReason>(
    report.reason,
  );
  const prefix = `report-${report.reportId}`;
  const isBusy = busyKey?.startsWith(`${report.reportId}:`) === true;

  return (
    <article className="form-card" aria-labelledby={`${prefix}-title`}>
      <p className="eyebrow">{stateLabel(report.state)}</p>
      <h2 id={`${prefix}-title`}>絵馬番号 {report.ema.slotNumber}</h2>
      <dl className="definition-list">
        <div>
          <dt>通報理由</dt>
          <dd>{reasonLabel(report.reason)}</dd>
        </div>
        <div>
          <dt>通報日時</dt>
          <dd>{formatDate(report.createdAt)}</dd>
        </div>
        <div>
          <dt>対象の状態</dt>
          <dd>
            {report.ema.status} / version {report.ema.version}
          </dd>
        </div>
        <div>
          <dt>公開範囲</dt>
          <dd>
            {report.ema.visibility} / {report.ema.messageVisibility}
          </dd>
        </div>
      </dl>

      <h3>通報者の補足</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {report.detail || "補足はありません。"}
      </p>

      <h3>公開投影</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {report.ema.messageText ??
          (report.ema.status === "active"
            ? "本文は本人だけに公開されているため、運営画面にも表示しません。"
            : "非表示または削除済みのため、本文を表示しません。")}
      </p>
      <p className="fine-print">
        通報件数だけでは自動的に非表示になりません。作品操作と通報状態の変更は別々に確定します。
      </p>

      <div className="field">
        <label htmlFor={`${prefix}-reason`}>管理理由</label>
        <select
          id={`${prefix}-reason`}
          value={moderationReason}
          disabled={isBusy || report.ema.status === "deleted"}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setModerationReason(event.target.value as ReportReason)
          }
        >
          {REASON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="action-row">
        {report.ema.status === "active" ? (
          <button
            type="button"
            className="button button--secondary"
            disabled={isBusy}
            onClick={() => onModerate(report, "hide", moderationReason)}
          >
            非表示にする
          </button>
        ) : null}
        {report.ema.status === "hidden" ? (
          <button
            type="button"
            className="button button--secondary"
            disabled={isBusy}
            onClick={() => onModerate(report, "restore", moderationReason)}
          >
            公開へ戻す
          </button>
        ) : null}
        {report.ema.status !== "deleted" ? (
          <button
            type="button"
            className="button button--danger"
            disabled={isBusy}
            onClick={() => onModerate(report, "delete", moderationReason)}
          >
            削除する
          </button>
        ) : null}
        {report.state === "open" ? (
          <>
            <button
              type="button"
              className="button"
              disabled={isBusy}
              onClick={() => onUpdateReport(report, "resolved")}
            >
              対応済みにする
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={isBusy}
              onClick={() => onUpdateReport(report, "dismissed")}
            >
              対応不要にする
            </button>
          </>
        ) : null}
        {report.ema.status === "active" ? (
          <Link
            className="button button--quiet"
            href={`/w/${report.ema.worldSlug}/e/${report.ema.publicId}`}
            target="_blank"
            rel="noreferrer"
          >
            公開ページを確認
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function AdminDashboard() {
  const [filter, setFilter] = useState<ReportState>("open");
  const [items, setItems] = useState<AdminReport[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryKeysRef = useRef(new Map<string, RetryEntry>());

  const loadReports = useCallback(
    async (cursor: string | null, append: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ state: filter, limit: "50" });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`/api/v1/admin/reports?${query}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await responsePayload(response);
        if (!response.ok) {
          throw new AdminRequestError(
            errorMessage(payload, response.status),
            response.status,
          );
        }
        const result = payload as AdminReportListResponse;
        if (!Array.isArray(result?.items)) {
          throw new AdminRequestError("通報一覧の応答を確認できません。", null);
        }
        setItems((current) => {
          if (!append) return result.items;
          const byId = new Map(current.map((item) => [item.reportId, item]));
          for (const item of result.items) byId.set(item.reportId, item);
          return [...byId.values()];
        });
        setNextCursor(result.nextCursor);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(
          caught instanceof Error
            ? caught.message
            : "通報一覧を取得できませんでした。",
        );
        if (!append) {
          setItems([]);
          setNextCursor(null);
        }
      } finally {
        if (abortRef.current === controller) setIsLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReports(null, false);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [loadReports]);

  const idempotencyKey = useCallback(
    (operationKey: string, fingerprint: string): string => {
      const existing = retryKeysRef.current.get(operationKey);
      if (existing?.fingerprint === fingerprint) return existing.idempotencyKey;
      const next = crypto.randomUUID();
      retryKeysRef.current.set(operationKey, {
        fingerprint,
        idempotencyKey: next,
      });
      return next;
    },
    [],
  );

  const runMutation = useCallback(
    async (
      operationKey: string,
      url: string,
      method: "POST" | "PATCH",
      body: object,
      successMessage: string,
    ) => {
      const fingerprint = JSON.stringify(body);
      const key = idempotencyKey(operationKey, fingerprint);
      setBusyKey(operationKey);
      setError(null);
      setStatus(null);
      try {
        const response = await fetch(url, {
          method,
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: fingerprint,
        });
        const payload = await responsePayload(response);
        if (!response.ok) {
          const requestError = new AdminRequestError(
            errorMessage(payload, response.status),
            response.status,
          );
          if (response.status < 500 && response.status !== 429) {
            retryKeysRef.current.delete(operationKey);
          }
          throw requestError;
        }
        retryKeysRef.current.delete(operationKey);
        setStatus(successMessage);
        await loadReports(null, false);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "管理操作に失敗しました。",
        );
      } finally {
        setBusyKey(null);
      }
    },
    [idempotencyKey, loadReports],
  );

  function handleModerate(
    report: AdminReport,
    action: ModerationAction,
    reasonCode: ReportReason,
  ): void {
    if (!window.confirm(moderationConfirmation(action))) return;
    const operationKey = `${report.reportId}:moderation:${action}`;
    void runMutation(
      operationKey,
      `/api/v1/admin/emas/${report.ema.publicId}/moderation`,
      "POST",
      { action, reasonCode, expectedVersion: report.ema.version },
      action === "hide"
        ? "絵馬を非表示にし、監査記録を保存しました。"
        : action === "restore"
          ? "絵馬を公開へ戻し、監査記録を保存しました。"
          : "絵馬を削除し、監査記録を保存しました。",
    );
  }

  function handleUpdateReport(
    report: AdminReport,
    nextState: "resolved" | "dismissed",
  ): void {
    const label = nextState === "resolved" ? "対応済み" : "対応不要";
    if (!window.confirm(`この通報を「${label}」として記録しますか？`)) return;
    void runMutation(
      `${report.reportId}:state:${nextState}`,
      `/api/v1/admin/reports/${report.reportId}`,
      "PATCH",
      { state: nextState, expectedVersion: report.version },
      `通報を「${label}」として記録しました。`,
    );
  }

  return (
    <section aria-labelledby="admin-reports-heading">
      <div className="world-panel__header">
        <div>
          <h2 id="admin-reports-heading">通報キュー</h2>
          <p className="muted">
            一覧・作品操作・通報処理はそれぞれ管理権限を再確認します。
          </p>
        </div>
        <div className="field">
          <label htmlFor="admin-report-state">表示する状態</label>
          <select
            id="admin-report-state"
            value={filter}
            disabled={isLoading || busyKey !== null}
            onChange={(event) => {
              setFilter(event.target.value as ReportState);
              setStatus(null);
            }}
          >
            {STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="status-stack" aria-live="polite" aria-atomic="true">
        {status ? (
          <p className="form-message form-message--success">{status}</p>
        ) : null}
        {error ? (
          <p className="form-message form-message--error">{error}</p>
        ) : null}
        {isLoading ? <p>通報一覧を確認しています…</p> : null}
      </div>

      {!isLoading && !error && items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__symbol" aria-hidden="true">
            ✓
          </span>
          <p>この状態の通報はありません。</p>
        </div>
      ) : null}

      <div className="card-grid">
        {items.map((report) => (
          <AdminReportCard
            key={report.reportId}
            report={report}
            busyKey={busyKey}
            onModerate={handleModerate}
            onUpdateReport={handleUpdateReport}
          />
        ))}
      </div>

      <div className="action-row">
        <button
          type="button"
          className="button button--secondary"
          disabled={isLoading || busyKey !== null}
          onClick={() => void loadReports(null, false)}
        >
          一覧を更新
        </button>
        {nextCursor ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={isLoading || busyKey !== null}
            onClick={() => void loadReports(nextCursor, true)}
          >
            次の50件
          </button>
        ) : null}
      </div>
    </section>
  );
}
