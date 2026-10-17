export interface FullscreenHost {
  isFullscreen(): Promise<boolean>;
  setFullscreen(value: boolean): Promise<void>;
}

// Window transitions can finish after a close/unmount request. Serialize them
// and restore even when the OS has not yet reported the requested state.
export function createFullscreenSession(host: FullscreenHost) {
  let original: boolean | undefined;
  let lastAccepted: boolean | undefined;
  let attempted = false;
  let restored = false;
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const readState = async () => {
    const current = await host.isFullscreen();
    original ??= current;
    return current;
  };
  const requestState = async (value: boolean) => {
    attempted = true; restored = false;
    await host.setFullscreen(value);
    // A rejected command is not evidence of a pending OS transition. Keep the
    // last accepted target for successful commands whose state report is late.
    lastAccepted = value;
  };
  const restoreState = async () => {
    if (original === undefined) { restored = true; return; }
    const current = await host.isFullscreen();
    if (current !== original || (lastAccepted !== undefined && lastAccepted !== original)) {
      await requestState(original);
    }
    restored = true;
  };
  return {
    read: () => run(readState),
    set: (value: boolean) => run(async () => {
      if (disposed) return host.isFullscreen();
      const current = await readState();
      if (disposed) return current;
      restored = false;
      if (current !== value || (lastAccepted !== undefined && lastAccepted !== value)) {
        await requestState(value);
      }
      return host.isFullscreen();
    }),
    restore: () => run(restoreState),
    dispose: () => {
      disposed = true;
      return run(async () => {
        // Discarded StrictMode setup owns no window changes. A completed close
        // also must not revert fullscreen entered by the next preview session.
        if (attempted && !restored) await restoreState();
      });
    },
  };
}
