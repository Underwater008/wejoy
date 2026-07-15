import { useCallback, useEffect, useRef, useState } from "react";

export function usePolling<T>(loader: () => Promise<T>, intervalMs = 4_000) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await loaderRef.current();
    setData(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, refresh]);

  return { data, loading, refresh, setData };
}
