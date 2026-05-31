import { useStore } from "./store/store.js";
import { Landing } from "./screens/Landing.js";
import { Host } from "./screens/Host.js";
import { Player } from "./screens/Player.js";
import { ConnectionBanner, ErrorToast, FlashOverlay } from "./components/common.js";

export function App() {
  const role = useStore((s) => s.role);
  const roomCode = useStore((s) => s.roomCode);

  let screen;
  if (!role || !roomCode) screen = <Landing />;
  else if (role === "host") screen = <Host />;
  else screen = <Player />;

  return (
    <div className="app">
      {screen}
      <FlashOverlay />
      <ConnectionBanner />
      <ErrorToast />
    </div>
  );
}
