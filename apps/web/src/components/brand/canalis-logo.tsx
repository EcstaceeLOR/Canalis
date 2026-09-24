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
            id="canalis-logo-gradient"
            x1="8"
            y1="14"
            x2="56"
            y2="50"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="currentColor" />
            <stop offset="1" stopColor="var(--color-accent-400)" />
          </linearGradient>
        </defs>
        <g
          stroke={tone === "brand" ? "url(#canalis-logo-gradient)" : "currentColor"}
          strokeWidth="5"
          strokeLinecap="round"
        >
          <path d="M9 14H17.5C23.5 14 25.8 18.3 28.7 24L32.5 31.5" />
          <path d="M9 32H32.5" />
          <path d="M9 50H17.5C23.5 50 25.8 45.7 28.7 40L32.5 32.5" />
          <path d="M32.5 32H55" />
        </g>
        <circle cx="9" cy="14" r="3.5" fill="currentColor" />
        <circle cx="9" cy="32" r="3.5" fill="currentColor" />
        <circle cx="9" cy="50" r="3.5" fill="currentColor" />
        <circle cx="55" cy="32" r="4" fill="var(--color-accent-400)" />
        <rect
          x="28.5"
          y="28.5"
          width="8"
          height="8"
          rx="2.25"
          transform="rotate(45 28.5 28.5)"
          fill="var(--color-bg-canvas)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      {compact ? null : <span className="canalis-logo-wordmark">CANALIS</span>}
    </span>
  );
}
