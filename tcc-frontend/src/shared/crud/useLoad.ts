import { useCallback, useEffect, useRef, useState } from "react";
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
  const latest = useRef({ fetcher, onLoaded: options.onLoaded });
  useEffect(() => {
    latest.current = { fetcher, onLoaded: options.onLoaded };
  });
  // busca e aplica o resultado; setState só após await (seguro em effect)
  const run = useCallback(async () => {
    try {
      const next = await latest.current.fetcher();
      setData(next);
      latest.current.onLoaded?.(next);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    await run();
  }, [run]);
  useRegisterCurrentViewRefresh(load);
  const { reloadOn } = options;
  useEffect(() => {
    // loading já inicia true e error undefined: só dispara a busca
    void run();
    if (!reloadOn) return;
    const reload = () => void load();
    window.addEventListener(reloadOn, reload);
    return () => window.removeEventListener(reloadOn, reload);
    // reloadOn estável por uso; antes só valia o da primeira renderização
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, loading, error, load };
}
