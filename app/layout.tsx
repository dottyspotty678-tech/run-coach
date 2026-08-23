import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "./register-sw";
import { TabBar } from "@/components/tab-bar";
import { OfflineBanner } from "@/components/offline-banner";

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
    { media: "(prefers-color-scheme: light)", color: "#f4f3ef" },
    { media: "(prefers-color-scheme: dark)", color: "#101214" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body className="antialiased min-h-screen pt-safe">
        <RegisterServiceWorker />
        <OfflineBanner />
        <div className="mx-auto w-full max-w-lg pb-tabbar">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
