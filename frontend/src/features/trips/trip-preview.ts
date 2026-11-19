import type { Km100Preview } from "../../types.ts";

/** Debounce and cancellation belong to this request, not to the form draft. */
export function scheduleTripPreview(options: {
  request: (signal: AbortSignal) => Promise<Km100Preview>;
  onPreview: (preview: Km100Preview) => void;
  onError: (error: Error) => void;
  onSettled: () => void;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
}) {
  const controller = new AbortController();
  let active = true;
  const timer = options.schedule(() => {
    options
      .request(controller.signal)
      .then((preview) => {
        if (active) options.onPreview(preview);
      })
      .catch((error: Error) => {
        if (active) options.onError(error);
      })
      .finally(() => {
        if (active) options.onSettled();
      });
  }, 300);
  return () => {
    active = false;
    options.cancel(timer);
    controller.abort();
  };
}
