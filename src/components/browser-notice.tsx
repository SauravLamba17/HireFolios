"use client";

import { useEffect, useState } from "react";
import { isSupportedBrowser } from "@/lib/browser";

/** A friendly banner on browsers other than Chrome / Edge (the app is tested on those two). */
export function BrowserNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }).userAgentData?.brands;
    setShow(!isSupportedBrowser({ userAgent: navigator.userAgent, brands }));
  }, []);
  if (!show) return null;
  return (
    <div role="note" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-amber-900">
      Please use <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> (a recent version). Some parts, such as the webcam, may not work in this browser.
      <button type="button" onClick={() => setShow(false)} className="ml-3 underline">Hide</button>
    </div>
  );
}
