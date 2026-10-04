import { useEffect, useState } from "react";
import { formatElapsed } from "./export-workflow";

export function ExportElapsed({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => performance.now() - startedAt);
  useEffect(() => {
    const tick = () => setElapsed(performance.now() - startedAt);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <span className="export-elapsed" aria-live="off">已用 {formatElapsed(elapsed)}</span>;
}
