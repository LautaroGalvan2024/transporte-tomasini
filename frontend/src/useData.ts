import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
type LoadOptions = {
  abortOnUnmount?: boolean;
  messageOf?: (error: Error) => string;
};
const errorMessage = (error: Error) => error.message;
export function useData<T>(
  path: string,
  { abortOnUnmount = false, messageOf = errorMessage }: LoadOptions = {},
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    const controller = abortOnUnmount ? new AbortController() : undefined;
    setLoading(true);
    setError("");
    api<T>(path, controller ? { signal: controller.signal } : undefined)
      .then((value) => {
        if (current) setData(value);
      })
      .catch((e) => {
        if (current) setError(messageOf(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      controller?.abort();
    };
  }, [path, revision, abortOnUnmount, messageOf]);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  return { data, error, loading, refresh, setData };
}
