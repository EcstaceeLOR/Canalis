import type { SVGProps } from "react";

type CanalisLogoProps = {
  compact?: boolean;
  tone?: "brand" | "mono" | "muted";
  className?: string;
  markProps?: SVGProps<SVGSVGElement>;
};

export function CanalisLogo({
  compact = false,
  tone = "brand",
  className = "",
  markProps,
}: CanalisLogoProps) {
  const fill = tone === "brand" ? "url(#canalis-flow-inline)" : "currentColor";

  return (
    <span className={`canalis-logo canalis-logo-${tone} ${className}`.trim()}>
      <svg
        aria-hidden="true"
        className="canalis-logo-mark"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...markProps}
      >
        <defs>
          <linearGradient
            id="canalis-flow-inline"
            x1="7"
            y1="18"
            x2="58"
            y2="47"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#43E6C8" />
            <stop offset="0.52" stopColor="#4F9BFF" />
            <stop offset="1" stopColor="#8B7CFF" />
          </linearGradient>
        </defs>
        <path
          d="M6 37.5C14.5 25.8 20.2 18.4 28.5 17.4C36 16.5 40.7 22 44.5 26.2C48.5 30.6 52.2 29.5 58.5 22.7C56.3 31.7 51.1 37.2 44.7 37.2C36.7 37.2 32.8 28.3 26.7 28.3C19.9 28.3 14.3 33 9.2 39.4L6 37.5Z"
          fill={fill}
        />
        <path
          d="M8.2 44.8C15 36.7 20.8 32.4 27 33.1C34.1 33.9 38.2 43.1 45 43.1C50.2 43.1 54.3 39.6 58.5 35.3C56.4 44.5 51.1 50.3 44 50.3C35.1 50.3 31.2 41.3 25.1 41.3C19.3 41.3 14.4 45.2 10.2 49.3L8.2 44.8Z"
          fill={fill}
          opacity={tone === "brand" ? 0.86 : 0.78}
        />
        <circle
          cx="57.5"
          cy="31.9"
          r="4.2"
          fill={tone === "brand" ? "#43E6C8" : "currentColor"}
        />
      </svg>
      {compact ? null : <span className="canalis-logo-wordmark">Canalis</span>}
    </span>
  );
}
