import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Lobby from "./pages/Lobby";
import Room from "./pages/Room";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/room/:roomId" element={<Room />} />
        {/* Catch-all → lobby */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
