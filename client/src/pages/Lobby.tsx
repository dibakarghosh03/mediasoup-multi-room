import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_BACKEND_URL;

export default function Lobby() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<string[]>([]);
  const [newRoomId, setNewRoomId] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function fetchRooms() {
    try {
      const res = await fetch(`${API_BASE}/rooms`);
      const data = await res.json();
      setRooms(data.rooms);
    } catch (err) {
      console.error("Failed to fetch rooms", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRooms();
    // Poll every 4s so the list stays fresh
    const interval = setInterval(fetchRooms, 4000);
    return () => clearInterval(interval);
  }, []);

  function handleJoin(roomId: string) {
    navigate(`/room/${roomId}`);
  }

  function handleCreate() {
    const id = newRoomId.trim();
    if (!id) return;
    setCreating(true);
    navigate(`/room/${id}`);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-8 font-mono">
      {/* Header */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white mb-2">
          mesh<span className="text-emerald-400">.</span>call
        </h1>
        <p className="text-zinc-500 text-sm">
          peer-to-peer video rooms powered by mediasoup
        </p>
      </div>

      <div className="w-full max-w-md space-y-8">
        {/* Create a new room */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-4">
            Create Room
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newRoomId}
              onChange={(e) => setNewRoomId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="room-name"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
            />
            <button
              onClick={handleCreate}
              disabled={!newRoomId.trim() || creating}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-bold text-sm px-5 py-2 rounded-lg transition-colors"
            >
              {creating ? "..." : "Create"}
            </button>
          </div>
        </div>

        {/* Existing rooms */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">
              Active Rooms
            </h2>
            <span className="text-xs text-zinc-600">
              {rooms.length} room{rooms.length !== 1 ? "s" : ""}
            </span>
          </div>

          {loading ? (
            <div className="text-zinc-600 text-sm text-center py-6">
              Loading...
            </div>
          ) : rooms.length === 0 ? (
            <div className="text-zinc-600 text-sm text-center py-6">
              No active rooms. Create one above.
            </div>
          ) : (
            <ul className="space-y-2">
              {rooms.map((roomId) => (
                <li key={roomId}>
                  <button
                    onClick={() => handleJoin(roomId)}
                    className="w-full flex items-center justify-between bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-emerald-500/50 rounded-lg px-4 py-3 text-sm transition-all group"
                  >
                    <span className="text-zinc-200 group-hover:text-white">
                      # {roomId}
                    </span>
                    <span className="text-xs text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity">
                      Join →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
