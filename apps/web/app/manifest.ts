import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kàddu",
    short_name: "Kàddu",
    description: "Fix AI transcripts, get paid in sats",
    start_url: "/",
    display: "standalone",
    background_color: "#f3ead7",
    theme_color: "#1e2a78",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
