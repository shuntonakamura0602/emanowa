"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  adminWorldPostingResponseSchema,
  type AdminWorldPosting,
  type WorldPostingReason,
} from "@/server/admin/contracts";

const REASON_OPTIONS: readonly {
  value: WorldPostingReason;
  label: string;
}[] = [
  { value: "incident", label: "障害対応" },
  { value: "abuse", label: "不正利用・荒らし対応" },
  { value: "maintenance", label: "保守作業" },
  { value: "capacity", label: "容量・負荷対応" },
  { value: "launch_control", label: "公開準備・公開判断" },
  { value: "other", label: "その他の運用判断" },
];

const DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

type ApiErrorPayload = { error?: { message?: unknown } };

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseError(payload: unknown, fallback: string): string {
  const candidate = payload as ApiErrorPayload | null;
  return typeof candidate?.error?.message === "string"
    ? candidate.error.message
    : fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? DATE_FORMATTER.format(date)
    : "日時を確認できません";
}

export function AdminWorldPostingControl({ worldSlug }: { worldSlug: string }) {
  const [world, setWorld] = useState<AdminWorldPosting | null>(null);
  const [reasonCode, setReasonCode] = useState<WorldPostingReason>("incident");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const retryRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);

  const endpoint = `/api/v1/admin/worlds/${encodeURIComponent(worldSlug)}/posting`;

  const load = useCallback(async (): Promise<AdminWorldPosting | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(
          responseError(payload, "受付状態を確認できませんでした。"),
        );
      }
      const parsed = adminWorldPostingResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error("受付状態の応答を確認できません。");
      setWorld(parsed.data.world);
      return parsed.data.world;
    } catch (caught) {
      setWorld(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "受付状態を確認できませんでした。",
      );
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function changePostingEnabled(postingEnabled: boolean): Promise<void> {
    if (!world) return;
    const action = postingEnabled ? "再開" : "停止";
    const consequence = postingEnabled
      ? "worldの状態と受付期間を満たす場合だけ、新規投稿を再開します。"
      : "新規投稿だけを停止します。既存作品の閲覧、本人の公開縮小・削除、通報は維持します。";
    if (!window.confirm(`新規投稿を${action}します。${consequence}`)) return;

    const body = {
      postingEnabled,
      reasonCode,
      expectedPostingEnabled: world.postingEnabled,
    };
    const fingerprint = JSON.stringify(body);
    const retry = retryRef.current;
    const idempotencyKey =
      retry?.fingerprint === fingerprint
        ? retry.idempotencyKey
        : crypto.randomUUID();
    retryRef.current = { fingerprint, idempotencyKey };

    setIsSaving(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: fingerprint,
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) {
          retryRef.current = null;
        }
        throw new Error(
          responseError(payload, `新規投稿を${action}できませんでした。`),
        );
      }
      const parsed = adminWorldPostingResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error("受付状態の応答を確認できません。");
      retryRef.current = null;
      const current = await load();
      if (!current) return;
      if (current.postingEnabled !== postingEnabled) {
        setError(
          "操作後に別の受付操作が行われました。表示中の現在値を確認してください。",
        );
        return;
      }
      setStatus(
        `現在値を再確認しました。新規投稿を${action}し、監査記録を保存しました。`,
      );
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : `新規投稿を${action}できませんでした。`;
      await load();
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="form-card" aria-labelledby="admin-world-posting-title">
      <p className="eyebrow">緊急運用</p>
      <h2 id="admin-world-posting-title">新規投稿の受付</h2>
      <p className="muted">
        この操作は新規投稿だけを切り替えます。worldの公開状態や受付期間を変更せず、既存作品の閲覧・本人操作・通報も止めません。
      </p>

      {world ? (
        <dl className="definition-list">
          <div>
            <dt>対象</dt>
            <dd>{world.worldName}</dd>
          </div>
          <div>
            <dt>world状態</dt>
            <dd>{world.state}</dd>
          </div>
          <div>
            <dt>受付スイッチ</dt>
            <dd>{world.postingEnabled ? "有効" : "停止中"}</dd>
          </div>
          <div>
            <dt>受付期間（日本時間）</dt>
            <dd>
              {formatDate(world.opensAt)}〜{formatDate(world.closesAt)}
            </dd>
          </div>
          <div>
            <dt>最終操作</dt>
            <dd>{formatDate(world.updatedAt)}</dd>
          </div>
        </dl>
      ) : null}

      <div className="field">
        <label htmlFor="admin-world-posting-reason">運用理由</label>
        <select
          id="admin-world-posting-reason"
          value={reasonCode}
          disabled={isLoading || isSaving || !world}
          onChange={(event) =>
            setReasonCode(event.target.value as WorldPostingReason)
          }
        >
          {REASON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="status-stack" aria-live="polite" aria-atomic="true">
        {isLoading ? <p>受付状態を確認しています…</p> : null}
        {status ? (
          <p className="form-message form-message--success">{status}</p>
        ) : null}
        {error ? (
          <p className="form-message form-message--error">{error}</p>
        ) : null}
      </div>

      <div className="action-row">
        {world?.postingEnabled ? (
          <button
            type="button"
            className="button button--danger"
            disabled={isLoading || isSaving}
            onClick={() => void changePostingEnabled(false)}
          >
            新規投稿を停止
          </button>
        ) : null}
        {world && !world.postingEnabled ? (
          <button
            type="button"
            className="button"
            disabled={isLoading || isSaving}
            onClick={() => void changePostingEnabled(true)}
          >
            新規投稿を再開
          </button>
        ) : null}
        <button
          type="button"
          className="button button--secondary"
          disabled={isLoading || isSaving}
          onClick={() => void load()}
        >
          状態を更新
        </button>
      </div>
    </section>
  );
}
