import type { MetadataRoute } from "next";

/**
 * PWA manifest. We need a service worker for push anyway, so making the app
 * installable is essentially free — and an installed PWA is the only way to get
 * push notifications working on iOS (Safari requires "Add to Home Screen"
 * before it will grant Notification permission at all).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SG Laundry — rain & drying advisor",
    short_name: "SG Laundry",
    description:
      "Live Singapore rain conditions and laundry drying recommendations for any point on the map.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    categories: ["weather", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
