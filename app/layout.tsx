import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SG Laundry — rain & drying advisor",
  description:
    "Drop a pin anywhere in Singapore for live rain conditions and a laundry drying recommendation.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "SG Laundry",
    statusBarStyle: "black-translucent",
  },
  // No analytics, no tracking pixels, nothing that phones home.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
