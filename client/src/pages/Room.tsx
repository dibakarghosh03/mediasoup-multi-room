import { useNavigate, useParams } from "react-router-dom";
import { useMediasoup } from "../hooks/useMediasoup";

const statusLabel: Record<string, string> = {
  idle: "Initialising...",
  "loading-device": "Loading device...",
  "getting-camera": "Accessing camera...",
  streaming: "Live",
  error: "Error",
};

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  if (!roomId) return;

  const { status, errorMsg, remotePeers, localVideoRef, remoteVideoRefs } =
    useMediasoup(roomId!);

  const isLive = status === "streaming";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-mono">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            ← Back
          </button>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-400 text-sm">#{roomId}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Live indicator dot */}
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isLive
                ? "bg-emerald-400 animate-pulse"
                : status === "error"
                  ? "bg-red-500"
                  : "bg-zinc-600"
            }`}
          />
          <span
            className={`text-xs ${
              isLive
                ? "text-emerald-400"
                : status === "error"
                  ? "text-red-400"
                  : "text-zinc-500"
            }`}
          >
            {statusLabel[status] ?? status}
          </span>

          {isLive && (
            <span className="ml-3 text-xs text-zinc-600">
              {remotePeers.length + 1} participant
              {remotePeers.length !== 0 ? "s" : ""}
            </span>
          )}
        </div>
      </header>

      {/* Error state */}
      {status === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-red-400 text-sm">{errorMsg}</p>
          <button
            onClick={() => navigate("/")}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline"
          >
            Back to lobby
          </button>
        </div>
      )}

      {/* Video grid */}
      {status !== "error" && (
        <main className="flex-1 p-6">
          <div
            className={`grid gap-4 h-full ${
              remotePeers.length === 0
                ? "grid-cols-1 max-w-lg mx-auto"
                : remotePeers.length === 1
                  ? "grid-cols-2"
                  : remotePeers.length <= 3
                    ? "grid-cols-2"
                    : "grid-cols-3"
            }`}
          >
            {/* Local video — always first */}
            <VideoTile
              label="You"
              videoRef={localVideoRef}
              muted
              isLoading={!isLive}
            />

            {/* Remote peers */}
            {remotePeers.map((socketId) => (
              <VideoTile
                key={socketId}
                label={`Peer · ${socketId.slice(0, 6)}`}
                videoRef={(el) => {
                  if (el) remoteVideoRefs.current.set(socketId, el);
                  else remoteVideoRefs.current.delete(socketId);
                }}
              />
            ))}
          </div>
        </main>
      )}
    </div>
  );
}

// ── VideoTile ────────────────────────────────────────────────────────────────

interface VideoTileProps {
  label: string;
  videoRef:
    | React.RefObject<HTMLVideoElement>
    | ((el: HTMLVideoElement | null) => void);
  muted?: boolean;
  isLoading?: boolean;
}

function VideoTile({
  label,
  videoRef,
  muted = false,
  isLoading = false,
}: VideoTileProps) {
  return (
    <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 aspect-video flex items-center justify-center">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-zinc-700 text-xs">Waiting for camera...</span>
        </div>
      )}
      <video
        // ref can be either a RefObject or a callback ref
        ref={videoRef as React.RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        muted={muted}
        className="w-full h-full object-cover"
        style={muted ? { transform: "scaleX(-1)" } : undefined}
      />
      {/* Name badge */}
      <div className="absolute bottom-3 left-3 bg-zinc-950/70 backdrop-blur-sm text-zinc-300 text-xs px-2 py-1 rounded-md">
        {label}
      </div>
    </div>
  );
}
