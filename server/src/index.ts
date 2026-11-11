import express from "express";
import https from "https";
import fs from "fs";
import { Server } from "socket.io";
import * as mediasoup from "mediasoup";
import cors from "cors";
import dotenv from "dotenv";
import { roomManager } from "./roomManager";
import { handleSocket } from "./socketHandler";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/rooms", (req, res) => {
  res.json({ rooms: roomManager.getRoomIds() });
});

// Read the SSL certificate
const httpsServer = https.createServer(
  {
    key: fs.readFileSync("./certs/key.pem"),
    cert: fs.readFileSync("./certs/cert.pem"),
  },
  app,
);

// Attach socket to the HTTPS Server
const io = new Server(httpsServer, {
  cors: { origin: "*" },
});

async function main() {
  // Create mediasoup worker (the c++ subprocess)
  const worker = await mediasoup.createWorker({
    logLevel: "warn",
  });

  worker.on("died", () => {
    console.error("mediasoup worker died, exiting...");
    process.exit(1);
  });

  console.log("mediasoup worker created");

  await roomManager.init(worker);

  io.on("connection", (socket) => handleSocket(socket, io));

  httpsServer.listen(3001, () => {
    console.log(
      `Server listening on https://${process.env.ANNOUNED_ADDRESS}:3001`,
    );
  });
}

main().catch(console.error);
