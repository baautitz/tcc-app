import { useCallback, useEffect, useState } from "react";
import { useRegisterCurrentViewRefresh } from "@/shared/context/CurrentViewRefreshContext";
import { errorMessage } from "@/shared/lib/errors";

/** Carrega dados da seção uma vez, expõe loading/erro e registra o refresh da view. */
export function useLoad<T>(
  fetcher: () => Promise<T>,
  initial: T,
  options: { onLoaded?: (data: T) => void; reloadOn?: string } = {},
) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(undefined);
      const next = await fetcher();
      setData(next);
      options.onLoaded?.(next);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRegisterCurrentViewRefresh(load);
  useEffect(() => {
    void load();
    if (!options.reloadOn) return;
    const reload = () => void load();
    window.addEventListener(options.reloadOn, reload);
    return () => window.removeEventListener(options.reloadOn!, reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, loading, error, load };
}
