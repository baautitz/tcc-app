import { useRef, useState } from "react";
import { ApiError } from "@/shared/api/client";
import { queriesApi } from "@/modules/queries/api/queries.api";
import type { SavedQuery } from "@/modules/queries/model/types";

type Body = Parameters<typeof queriesApi.createQuery>[0];

/** Shared save plumbing: pending guard, create/update dispatch and 409 refresh. */
export function useSaveQuery() {
  const pendingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  /** Runs fn under the pending guard; no-op if a save is already running. */
  const run = async (fn: () => Promise<void>) => {
    pendingRef.current = true;
    setSaving(true);
    try {
      await fn();
    } finally {
      pendingRef.current = false;
      setSaving(false);
    }
  };

  const persist = (
    id: string | undefined,
    body: Body,
    expectedUpdatedAt?: string,
  ): Promise<SavedQuery> =>
    id
      ? queriesApi.updateQuery(id, {
          ...body,
          expectedUpdatedAt: expectedUpdatedAt!,
        })
      : queriesApi.createQuery(body);

  /** On a 409 for an existing query, fetches the latest version (undefined if it fails). */
  const reloadOnConflict = async (
    id: string,
  ): Promise<SavedQuery | undefined> => {
    try {
      return await queriesApi.savedQuery(id);
    } catch {
      return undefined;
    }
  };

  return {
    pendingRef,
    saving,
    run,
    persist,
    reloadOnConflict,
    isConflict: (r: unknown) => r instanceof ApiError && r.status === 409,
  };
}
