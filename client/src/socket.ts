import { io } from "socket.io-client";

const socket = io(`${import.meta.env.VITE_BACKEND_URL}`, {
  autoConnect: true,
  rejectUnauthorized: false,
});

export default socket;
