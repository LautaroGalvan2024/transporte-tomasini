import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { Km100Preview } from "../../types";
import type { TripPreviewRequest } from "./trip-draft";
import { scheduleTripPreview } from "./trip-preview";

type PreviewOptions = {
  evaluate: boolean;
  validInputs: boolean;
  inputKey: string;
  resolve: boolean;
  createRequest: () => TripPreviewRequest;
  restoreSavedValue: () => void;
  onSuggestedValue: (value: string) => void;
};

export function useKm100Preview(options: PreviewOptions) {
  const { evaluate, validInputs, inputKey, resolve } = options;
  const latest = useRef(options);
  latest.current = options;
  const [preview, setPreview] = useState<Km100Preview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const invalidate = useCallback((clearError = true) => {
    setPreview(null);
    setPreviewKey("");
    if (clearError) setError("");
  }, []);
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const current = latest.current;
    if (!evaluate || !validInputs) {
      setPreview(null);
      setPreviewKey("");
      setBusy(false);
      setError("");
      if (!evaluate) current.restoreSavedValue();
      return;
    }
    setBusy(true);
    setError("");
    return scheduleTripPreview({
      request: (signal) =>
        api<Km100Preview>("/trips/km100-preview", {
          method: "POST",
          signal,
          body: JSON.stringify(current.createRequest()),
        }),
      onPreview: (result) => {
        setPreview(result);
        setPreviewKey(inputKey);
        if (result.suggestedKm !== null)
          current.onSuggestedValue(String(result.suggestedKm));
      },
      onError: (failure) => setError(failure.message),
      onSettled: () => setBusy(false),
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
    });
  }, [evaluate, validInputs, inputKey, revision, resolve]);

  return {
    currentPreview: previewKey === inputKey ? preview : null,
    error,
    busy,
    invalidate,
    retry,
  };
}
