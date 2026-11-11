import * as mediasoup from "mediasoup";

type Router = mediasoup.types.Router;
type Worker = mediasoup.types.Worker;
type WebRtcTransport = mediasoup.types.WebRtcTransport;
type Producer = mediasoup.types.Producer;
type Consumer = mediasoup.types.Consumer;
type RtpCapabilities = mediasoup.types.RtpCapabilities;

interface Peer {
  sendTransport: WebRtcTransport | null;
  recvTransport: WebRtcTransport | null;
  videoProducer: Producer | null;
  audioProducer: Producer | null;
  consumers: Map<string, Consumer>;
}

// The codecs our server will support
// This tells mediasoup what kind of audio/video it should be able to route
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
  },
] as mediasoup.types.RtpCodecCapability[];

class Room {
  public readonly roomId: string;
  private router: Router;
  private peers: Map<string, Peer> = new Map();

  constructor(roomId: string, router: Router) {
    this.roomId = roomId;
    this.router = router;
  }

  getRtpCapabilities(): RtpCapabilities {
    return this.router.rtpCapabilities;
  }

  async createWebRtcTransport(socketId: string, direction: "send" | "recv") {
    const transport = await this.router.createWebRtcTransport({
      listenInfos: [
        {
          protocol: "udp",
          ip: "0.0.0.0",
          announcedAddress: process.env.ANNOUNED_ADDRESS,
          portRange: { min: 10000, max: 10100 },
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    // Make sure this peer exists in map
    if (!this.peers.has(socketId)) {
      this.peers.set(socketId, {
        sendTransport: null,
        recvTransport: null,
        videoProducer: null,
        audioProducer: null,
        consumers: new Map(),
      });
    }

    const peer = this.peers.get(socketId)!;

    if (direction === "send") peer.sendTransport = transport;
    else peer.recvTransport = transport;

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(
    socketId: string,
    direction: "send" | "recv",
    dtlsParameters: mediasoup.types.DtlsParameters,
  ) {
    const peer = this.peers.get(socketId);
    if (!peer) throw new Error("Peer not found");

    const transport =
      direction === "send" ? peer.sendTransport : peer.recvTransport;

    if (!transport) throw new Error(`${direction} transport not found`);

    await transport.connect({ dtlsParameters });
  }

  async produce(
    socketId: string,
    kind: mediasoup.types.MediaKind,
    rtpParameters: mediasoup.types.RtpParameters,
  ) {
    const peer = this.peers.get(socketId);
    if (!peer?.sendTransport) throw new Error("Send transport not found");

    const producer = await peer.sendTransport.produce({ kind, rtpParameters });

    if (kind === "video") peer.videoProducer = producer;
    else peer.audioProducer = producer;

    return producer.id;
  }

  async consume(
    socketId: string,
    producerSocketId: string,
    rtpCapabilities: RtpCapabilities,
  ) {
    const producerPeer = this.peers.get(producerSocketId);
    if (!producerPeer || !producerPeer.videoProducer)
      throw new Error("Producer not found");

    const consumerPeer = this.peers.get(socketId);
    if (!consumerPeer || !consumerPeer.recvTransport)
      throw new Error("Recv transport not found");

    let result: any = {};

    if (producerPeer.videoProducer) {
      if (
        !this.router.canConsume({
          producerId: producerPeer.videoProducer.id,
          rtpCapabilities,
        })
      )
        throw new Error("Cannot consume video");

      const videoConsumer = await consumerPeer.recvTransport.consume({
        producerId: producerPeer.videoProducer.id,
        rtpCapabilities,
        paused: false,
      });

      consumerPeer.consumers.set(videoConsumer.id, videoConsumer);

      result.video = {
        id: videoConsumer.id,
        producerId: producerPeer.videoProducer.id,
        kind: videoConsumer.kind,
        rtpParameters: videoConsumer.rtpParameters,
      };
    }

    if (producerPeer.audioProducer) {
      if (
        !this.router.canConsume({
          producerId: producerPeer.audioProducer.id,
          rtpCapabilities,
        })
      )
        throw new Error("Cannot consume audio");

      const audioConsumer = await consumerPeer.recvTransport.consume({
        producerId: producerPeer.audioProducer.id,
        rtpCapabilities,
        paused: false,
      });

      consumerPeer.consumers.set(audioConsumer.id, audioConsumer);

      result.audio = {
        id: audioConsumer.id,
        producerId: producerPeer.audioProducer.id,
        kind: audioConsumer.kind,
        rtpParameters: audioConsumer.rtpParameters,
      };
    }

    return result;
  }

  removePeer(socketId: string) {
    const peer = this.peers.get(socketId);
    if (!peer) return;
    peer.videoProducer?.close();
    peer.audioProducer?.close();
    peer.sendTransport?.close();
    peer.recvTransport?.close();
    peer.consumers.forEach((c) => c.close());
    this.peers.delete(socketId);
    console.log(`Peer ${socketId} removed from room ${this.roomId}`);
  }

  getProducerSocketIds(excludeSocketId: string): string[] {
    const ids: string[] = [];
    for (const [socketId, peer] of this.peers) {
      if (socketId !== excludeSocketId && peer.videoProducer)
        ids.push(socketId);
    }
    return ids;
  }

  get isEmpty(): boolean {
    return this.peers.size === 0;
  }
}

class RoomManager {
  private worker: Worker | null = null;
  private rooms: Map<string, Room> = new Map();
  // Track which room each socket is in, for quick disconnect lookup
  private socketToRoom: Map<string, string> = new Map();

  async init(worker: Worker) {
    this.worker = worker;
  }

  async getOrCreateRoom(roomId: string): Promise<Room> {
    if (this.rooms.has(roomId)) return this.rooms.get(roomId)!;
    if (!this.worker) throw new Error("Worker not initialized");

    const router = await this.worker.createRouter({ mediaCodecs });
    const room = new Room(roomId, router);

    this.rooms.set(roomId, room);
    console.log(`Room created: ${roomId}`);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  // Call this when a socket joins a room
  registerSocket(socketId: string, roomId: string) {
    this.socketToRoom.set(socketId, roomId);
  }

  // Returns the room a socket is currently in
  getRoomForSocket(socketId: string): Room | undefined {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  // On disconnect: clean up the peer and remove empty rooms
  removePeer(socketId: string) {
    const room = this.getRoomForSocket(socketId);
    if (!room) return;

    room.removePeer(socketId);
    this.socketToRoom.delete(socketId);

    if (room.isEmpty) {
      this.rooms.delete(room.roomId);
      console.log(`Room ${room.roomId} was empty and removed`);
    }
  }
}

export const roomManager = new RoomManager();
