import type { Metadata } from "next";
import { PinPad } from "./pin-pad";

export const metadata: Metadata = { title: "Run Coach — PIN" };

// The PIN screen is a full-screen takeover with no tab bar (hidden by the
// TabBar component) and is excluded from service-worker caching.
export default function PinPage() {
  return <PinPad />;
}
