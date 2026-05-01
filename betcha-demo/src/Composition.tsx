import {
  AbsoluteFill,
  Img,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const shots = [
  {
    src: staticFile("/shots/01_markets_home.png"),
    title: "Markets feed",
    subtitle: "Browse open and resolved markets",
  },
  {
    src: staticFile("/shots/02_typing_question.png"),
    title: "Create flow",
    subtitle: "Type the question naturally",
  },
  {
    src: staticFile("/shots/03_group_dropdown.png"),
    title: "Pick group",
    subtitle: "Route each market to the right group",
  },
  {
    src: staticFile("/shots/04_market_detail.png"),
    title: "Live market detail",
    subtitle: "Track odds and position in real-time",
  },
  {
    src: staticFile("/shots/05_prediction_placed.png"),
    title: "Prediction placed",
    subtitle: "Confirm your stake in one tap",
  },
  {
    src: staticFile("/shots/06_resolve_market.png"),
    title: "Resolve with evidence",
    subtitle: "Close the market with transparent outcomes",
  },
] as const;

const brand = {
  background: "#0B0E1A",
  text: "#F4F6FF",
  muted: "#ADB5D6",
  accent: "#FF6D85",
};

export const BetchaDemoComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const shotDuration = 64;
  const fadeFrames = 10;

  const bgPulse = interpolate(
    frame,
    [0, durationInFrames],
    [0, 100],
    { easing: Easing.inOut(Easing.quad), extrapolateRight: "clamp" }
  );

  const intro = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const outroStart = durationInFrames - 40;
  const outro = interpolate(frame, [outroStart, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const timelineStart = 36;

  return (
    <AbsoluteFill
      style={{
        fontFamily:
          "Inter, SF Pro Display, SF Pro Text, -apple-system, BlinkMacSystemFont, sans-serif",
        background: `radial-gradient(circle at ${20 + bgPulse * 0.5}% ${
          18 + bgPulse * 0.3
        }%, #202848 0%, ${brand.background} 62%, #05070E 100%)`,
        color: brand.text,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 76,
          fontSize: 26,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: "#F1D5DC",
          border: "1px solid #ffffff40",
          borderRadius: 999,
          padding: "10px 18px",
          background: "#ffffff12",
          opacity: intro * outro,
        }}
      >
        Betcha App Walkthrough
      </div>

      {shots.map((shot, index) => {
        const start = timelineStart + index * shotDuration;
        const local = frame - start;
        const fadeIn = interpolate(local, [0, fadeFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const fadeOut = interpolate(
          local,
          [shotDuration - fadeFrames, shotDuration],
          [1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }
        );
        const opacity = Math.max(0, Math.min(1, fadeIn * fadeOut));
        const zoom = interpolate(local, [0, shotDuration], [1.02, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.quad),
        });
        const shiftY = interpolate(local, [0, shotDuration], [14, -10], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={shot.src}
            style={{
              position: "absolute",
              inset: 0,
              opacity: opacity * intro * outro,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 110,
                left: 620,
                width: 860,
                height: 880,
                borderRadius: 64,
                overflow: "hidden",
                boxShadow: "0 36px 100px rgba(0,0,0,0.45)",
                border: "10px solid #131A31",
                background: "#0A0D17",
                transform: `translateY(${shiftY}px) scale(${zoom})`,
              }}
            >
              <Img
                src={shot.src}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                left: 80,
                bottom: 120,
                maxWidth: 460,
                opacity: 0.97,
              }}
            >
              <div
                style={{
                  fontSize: 66,
                  lineHeight: 1.05,
                  fontWeight: 800,
                }}
              >
                {shot.title}
              </div>
              <div
                style={{
                  marginTop: 16,
                  fontSize: 30,
                  lineHeight: 1.25,
                  color: brand.muted,
                }}
              >
                {shot.subtitle}
              </div>
            </div>
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          right: 82,
          bottom: 58,
          color: "#D3D8F0",
          fontSize: 28,
          letterSpacing: 0.4,
          borderBottom: `2px solid ${brand.accent}`,
          paddingBottom: 4,
          opacity: outro,
        }}
      >
        betchaa.vercel.app
      </div>
    </AbsoluteFill>
  );
};
