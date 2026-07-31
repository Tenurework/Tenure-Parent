import { ImageResponse } from "next/og"

/**
 * Apple touch icon. iOS ignores SVG favicons and will otherwise screenshot the
 * page when a site is added to the home screen, so the rosette is rasterised to
 * PNG here at build time. Geometry mirrors src/app/icon.svg — keep in sync.
 */
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

const PETAL = "M16 16 C 12.4 10.5, 12.4 5.4, 16 3.4 C 19.6 5.4, 19.6 10.5, 16 16 Z"

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#1c8c5a",
        }}
      >
        <svg width="132" height="132" viewBox="0 0 32 32" fill="#ffffff">
          {[0, 60, 120, 180, 240, 300].map((r) => (
            <path key={r} d={PETAL} transform={`rotate(${r} 16 16)`} />
          ))}
        </svg>
      </div>
    ),
    size
  )
}
