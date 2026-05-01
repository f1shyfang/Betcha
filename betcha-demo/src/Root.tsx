import "./index.css";
import { Composition } from "remotion";
import { BetchaDemoComposition } from "./Composition";
import { videoConfig } from "./video-config";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="BetchaDemo"
        component={BetchaDemoComposition}
        durationInFrames={videoConfig.durationInFrames}
        fps={videoConfig.fps}
        width={videoConfig.width}
        height={videoConfig.height}
      />
    </>
  );
};
