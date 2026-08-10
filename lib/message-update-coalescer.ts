// Client-side coalescing of `message_update` SSE frames.
//
// omp emits message_update per token batch (often far above display rate) and
// every frame carries the FULL accumulated partial message, so dispatching each
// one re-renders the whole streaming bubble. Only the latest pending update is
// worth showing; buffer it and flush at animation-frame rate.
//
// Ordering contract:
// - Any non-update event type flushes the pending update synchronously BEFORE
//   it is dispatched, so no state is applied out of order.
// - `message_end` carries the complete message and therefore supersedes
//   (drops) any pending partial update.

export type CoalescableEvent = { type: string; [key: string]: unknown };

/** Schedules `flush` and returns a cancel function. */
export type FlushScheduler = (flush: () => void) => () => void;

export interface MessageUpdateCoalescer {
  push(event: CoalescableEvent): void;
  /** Drop any pending update and cancel the scheduled flush (stream replaced or unmounted). */
  reset(): void;
}

// requestAnimationFrame matches display rate but stalls in hidden tabs, so
// fall back to a trailing 50ms timer there (and outside the browser).
function defaultScheduler(flush: () => void): () => void {
  if (
    typeof document !== "undefined"
    && !document.hidden
    && typeof requestAnimationFrame === "function"
  ) {
    const id = requestAnimationFrame(flush);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(flush, 50);
  return () => clearTimeout(id);
}

export function createMessageUpdateCoalescer(
  dispatch: (event: CoalescableEvent) => void,
  schedule: FlushScheduler = defaultScheduler,
): MessageUpdateCoalescer {
  let pending: CoalescableEvent | null = null;
  let cancelScheduled: (() => void) | null = null;

  const cancel = () => {
    if (cancelScheduled) {
      cancelScheduled();
      cancelScheduled = null;
    }
  };

  const flush = () => {
    cancelScheduled = null;
    const event = pending;
    pending = null;
    if (event) dispatch(event);
  };

  return {
    push(event: CoalescableEvent) {
      if (event.type === "message_update") {
        pending = event;
        if (!cancelScheduled) cancelScheduled = schedule(flush);
        return;
      }
      if (event.type === "message_end") {
        pending = null;
        cancel();
      } else if (pending) {
        cancel();
        const buffered = pending;
        pending = null;
        dispatch(buffered);
      }
      dispatch(event);
    },
    reset() {
      pending = null;
      cancel();
    },
  };
}
