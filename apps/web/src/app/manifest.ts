import type { MetadataRoute } from "next"

/**
 * Web app manifest — makes an installed Tenure launch with the rosette icon and
 * the product's own surface colours instead of a browser-default white shell.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tenure",
    short_name: "Tenure",
    description:
      "Institutional knowledge that survives every leadership transition.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f0efe9",
    theme_color: "#1c8c5a",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  }
}
