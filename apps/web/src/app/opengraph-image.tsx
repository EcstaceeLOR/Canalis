import { ImageResponse } from "next/og";

export const alt = "Canalis — governed payments for autonomous agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "70px 76px",
        color: "#f6f7fb",
        background: "radial-gradient(circle at 18% 0%, #281f4b 0%, #0b0d12 42%, #08090d 100%)",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 58,
            height: 58,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid #8b7cff",
            borderRadius: 16,
            background: "linear-gradient(145deg, #15142a, #0f1820)",
            color: "#63e6d6",
            fontSize: 26,
            fontWeight: 800,
          }}
        >C</div>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "0.18em" }}>CANALIS</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
        <div style={{ color: "#beaefc", fontSize: 22, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Payment control for autonomous agents
        </div>
        <div style={{ marginTop: 22, fontSize: 72, lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.045em" }}>
          Give the agent a budget. Keep the money governed.
        </div>
        <div style={{ marginTop: 28, color: "#a8adb9", fontSize: 26, lineHeight: 1.45 }}>
          Bounded policies · machine-service routing · auditable receipts · Solana payment-channel settlement
        </div>
      </div>

      <div style={{ display: "flex", gap: 26, color: "#707684", fontSize: 19 }}>
        <span>Solana-native</span><span>•</span><span>Wallet-scoped</span><span>•</span><span>Non-custodial boundary</span>
      </div>
    </div>,
    size,
  );
}
