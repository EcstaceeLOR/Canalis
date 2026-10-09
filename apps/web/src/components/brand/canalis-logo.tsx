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
  const channelStroke = tone === "brand" ? "url(#canalis-channel-inline)" : "currentColor";
  const gateStroke = tone === "brand" ? "#43E6C8" : "currentColor";

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
            id="canalis-channel-inline"
            x1="11"
            y1="9"
            x2="54"
            y2="54"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#43E6C8" />
            <stop offset="0.52" stopColor="#4F9BFF" />
            <stop offset="1" stopColor="#8B7CFF" />
          </linearGradient>
        </defs>
        <path
          d="M47 16 32 8 13 19v26l19 11 15-8"
          stroke={channelStroke}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M23 32h31"
          stroke={channelStroke}
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="m36 23 9 9-9 9-9-9 9-9Z"
          fill="none"
          stroke={gateStroke}
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </svg>
      {compact ? null : <span className="canalis-logo-wordmark">Canalis</span>}
    </span>
  );
}
