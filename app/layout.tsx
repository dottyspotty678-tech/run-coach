import type { Metadata, Viewport } from "next";
import { Azeret_Mono, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { RegisterServiceWorker } from "./register-sw";
import { TabBar } from "@/components/tab-bar";
import { OfflineBanner } from "@/components/offline-banner";

// "Negative split" type roles (docs/DESIGN.md §3): a legible grotesk for
// prose and a timing-board mono for every figure. Self-hosted at build time.
const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body-app",
  display: "swap",
});

const digits = Azeret_Mono({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
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
    { media: "(prefers-color-scheme: light)", color: "#eef1f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0c111b" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={`${body.variable} ${digits.variable}`}>
      <body className="antialiased min-h-screen pt-safe">
        <RegisterServiceWorker />
        <OfflineBanner />
        <div className="mx-auto w-full max-w-lg pb-tabbar">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
