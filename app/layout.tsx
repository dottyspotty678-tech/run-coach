import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { RegisterServiceWorker } from "./register-sw";
import { TabBar } from "@/components/tab-bar";
import { OfflineBanner } from "@/components/offline-banner";

// "Waymark" type roles (docs/DESIGN.md §3): one signage superfamily —
// Barlow for prose, Barlow Condensed for fingerpost display lettering —
// plus a quiet route-card mono for figures. Self-hosted at build time.
const body = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-app",
  display: "swap",
});

const displayFace = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display-app",
  display: "swap",
});

const digits = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-digits-app",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Run Coach",
  description: "Personal running training and meal planning",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Run Coach",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8ebe1" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1411" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-GB"
      className={`${body.variable} ${displayFace.variable} ${digits.variable}`}
    >
      <body className="antialiased min-h-screen pt-safe">
        <RegisterServiceWorker />
        <OfflineBanner />
        <div className="mx-auto w-full max-w-lg pb-tabbar">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
