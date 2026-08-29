"use client";

import { useEffect, useState } from "react";

/** Global slim banner shown whenever the device is offline (REQUIREMENTS §5.2). */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // Deliberate mount-time read of an external system (navigator.onLine):
    // the server render can't know connectivity, so hydrate it once here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffline(!navigator.onLine);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      className="mx-4 mt-2 rounded-xl px-3 py-2 text-center text-[13px] font-medium"
      style={{ color: "var(--warn)", background: "var(--warn-soft)" }}
      role="status"
    >
      Offline — showing saved data
    </div>
  );
}
