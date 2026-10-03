import type { MetadataRoute } from "next";

/** PWA manifest: installable (required for web push on iOS 16.4+). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TripAI: where and when to go",
    short_name: "TripAI",
    description: "Tell us who you are and when you're free. TripAI tells you where and when to go, and shows its working.",
    start_url: "/trips",
    scope: "/",
    display: "standalone",
    background_color: "#f4efe6",
    theme_color: "#f4efe6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
