// socketHandler.ts
import { Socket, Server } from "socket.io";
import * as mediasoup from "mediasoup";
import { roomManager } from "./roomManager";

export function handleSocket(socket: Socket, io: Server) {
  console.log("Client connected:", socket.id);

  // NEW — client must emit this first before anything else
  socket.on(
    "joinRoom",
    async ({ roomId }: { roomId: string }, callback: Function) => {
      try {
        const room = await roomManager.getOrCreateRoom(roomId);
        roomManager.registerSocket(socket.id, roomId);

        // Put the socket in a Socket.IO room (for targeted broadcasts)
        socket.join(roomId);

        const rtpCapabilities = room.getRtpCapabilities();
        callback({ rtpCapabilities });
        console.log(`Socket ${socket.id} joined room ${roomId}`);
      } catch (err: any) {
        callback({ error: err.message });
      }
    },
  );

  // All handlers below look up the room from the socket's registration
  // No roomId needed in the payload — the server already knows

  socket.on("leaveRoom", () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (room) {
      io.to(room.roomId).emit("producerClosed", {
        producerSocketId: socket.id,
      });
      roomManager.removePeer(socket.id);
      socket.leave(room.roomId);
    }
  });

  socket.on(
    "createTransport",
    async (
      { direction }: { direction: "send" | "recv" },
      callback: Function,
    ) => {
      try {
        const room = roomManager.getRoomForSocket(socket.id);
        if (!room) throw new Error("Not in a room");
        const transportParams = await room.createWebRtcTransport(
          socket.id,
          direction,
        );
        callback({ transportParams });
      } catch (err: any) {
        callback({ error: err.message });
      }
    },
  );

  socket.on(
    "connectTransport",
    async (
      {
        direction,
        dtlsParameters,
      }: {
        direction: "send" | "recv";
        dtlsParameters: mediasoup.types.DtlsParameters;
      },
      callback: Function,
    ) => {
      try {
        const room = roomManager.getRoomForSocket(socket.id);
        if (!room) throw new Error("Not in a room");
        await room.connectTransport(socket.id, direction, dtlsParameters);
        callback({ connected: true });
      } catch (err: any) {
        callback({ error: err.message });
      }
    },
  );

  socket.on(
    "produce",
    async (
      {
        kind,
        rtpParameters,
      }: {
        kind: mediasoup.types.MediaKind;
        rtpParameters: mediasoup.types.RtpParameters;
      },
      callback: Function,
    ) => {
      try {
        const room = roomManager.getRoomForSocket(socket.id);
        if (!room) throw new Error("Not in a room");
        const producerId = await room.produce(socket.id, kind, rtpParameters);

        if (kind === "video") {
          // Broadcast only within this room
          socket
            .to(room.roomId)
            .emit("newProducer", { producerSocketId: socket.id });
        }

        callback({ producerId });
      } catch (err: any) {
        callback({ error: err.message });
      }
    },
  );

  socket.on(
    "consume",
    async (
      {
        producerSocketId,
        rtpCapabilities,
      }: {
        producerSocketId: string;
        rtpCapabilities: mediasoup.types.RtpCapabilities;
      },
      callback: Function,
    ) => {
      try {
        const room = roomManager.getRoomForSocket(socket.id);
        if (!room) throw new Error("Not in a room");
        const consumerParams = await room.consume(
          socket.id,
          producerSocketId,
          rtpCapabilities,
        );
        callback({ consumerParams });
      } catch (err: any) {
        callback({ error: err.message });
      }
    },
  );

  socket.on("getProducers", (callback: Function) => {
    try {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return callback({ producerSocketIds: [] });
      const producerSocketIds = room.getProducerSocketIds(socket.id);
      callback({ producerSocketIds });
    } catch (err: any) {
      callback({ error: err.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    const room = roomManager.getRoomForSocket(socket.id);
    if (room) {
      // Notify only peers in the same room
      io.to(room.roomId).emit("producerClosed", {
        producerSocketId: socket.id,
      });
    }
    roomManager.removePeer(socket.id);
  });
}
