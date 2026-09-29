import { useEffect } from "react";
import { useT } from "../engine/react.js";
import { useStation, type Notice } from "../station/station.js";

const VISIBLE_MS = 6000;

function NoticeItem({ notice }: { notice: Notice }) {
  const t = useT();
  const { dismiss } = useStation();
  useEffect(() => {
    const timer = setTimeout(() => {
      dismiss(notice.id);
    }, VISIBLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice.id, dismiss]);
  return (
    <li className="flex items-start gap-3 rounded-lg border border-live/60 bg-bg-2 px-4 py-3 text-sm shadow-lg">
      <span className="flex-1">{t(notice.key, notice.params)}</span>
      <button
        type="button"
        aria-label={t("core.notice.dismiss")}
        onClick={() => {
          dismiss(notice.id);
        }}
        className="text-muted hover:text-fg"
      >
        ×
      </button>
    </li>
  );
}

/** Avvisi dei comandi non riusciti, in basso a destra. */
export function Notices() {
  const { notices } = useStation();
  return (
    <ol
      role="alert"
      className="pointer-events-auto fixed right-4 bottom-4 z-40 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2"
    >
      {notices.map((notice) => (
        <NoticeItem key={notice.id} notice={notice} />
      ))}
    </ol>
  );
}
