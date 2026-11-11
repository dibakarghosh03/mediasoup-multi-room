import { useCallback, useEffect, useRef, useState } from "react";
import type { Device } from "mediasoup-client";
import type { Consumer, Producer, Transport } from "mediasoup-client/types";
import { loadDevice } from "../deviceManager";
import socket from "../socket";

export interface RemotePeer {
  socketId: string;
  stream: MediaStream;
}

export type CallStatus =
  | "idle"
  | "loading-device"
  | "getting-camera"
  | "streaming"
  | "error";

export function useMediasoup(roomId: string) {
  // ── mediasoup object refs (not state — no re-render needed) ──────────────
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producerRef = useRef<Producer | null>(null);
  const consumersRef = useRef<Map<string, Consumer>>(new Map());

  // ── video element refs ───────────────────────────────────────────────────
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  // ── reactive state ───────────────────────────────────────────────────────
  const [status, setStatus] = useState<CallStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [remotePeers, setRemotePeers] = useState<string[]>([]);

  const addRemotePeer = useCallback((socketId: string) => {
    setRemotePeers((prev) =>
      prev.includes(socketId) ? prev : [...prev, socketId],
    );
  }, []);

  const removeRemotePeer = useCallback((socketId: string) => {
    setRemotePeers((prev) => prev.filter((id) => id !== socketId));
    remoteVideoRefs.current.delete(socketId);
  }, []);

  // ── step 1: get local webcam ─────────────────────────────────────────────
  async function getLocalStream(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    return stream;
  }

  // ── step 2: create send transport + produce ──────────────────────────────
  async function createSendTransport(device: Device, stream: MediaStream) {
    const { transportParams, error } = await new Promise<any>((resolve) =>
      socket.emit("createTransport", { direction: "send" }, resolve),
    );
    if (error) throw new Error(error);

    const transport = device.createSendTransport(transportParams);
    sendTransportRef.current = transport;

    transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await new Promise<void>((resolve, reject) => {
          socket.emit(
            "connectTransport",
            { direction: "send", dtlsParameters },
            ({ error }: any) => (error ? reject(new Error(error)) : resolve()),
          );
        });
        callback();
      } catch (err: any) {
        errback(err.message);
      }
    });

    transport.on(
      "produce",
      async ({ kind, rtpParameters }, callback, errback) => {
        try {
          const { producerId, error } = await new Promise<any>((resolve) =>
            socket.emit("produce", { kind, rtpParameters }, resolve),
          );
          if (error) throw new Error(error);
          callback({ id: producerId });
        } catch (err: any) {
          errback(err.message);
        }
      },
    );

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    if (videoTrack) {
      producerRef.current = await transport.produce({ track: videoTrack });
    }
    if (audioTrack) {
      await transport.produce({ track: audioTrack });
    }
  }

  // ── step 3: create recv transport + consume a remote peer ────────────────
  async function consumeRemoteProducer(
    device: Device,
    producerSocketId: string,
  ) {
    // Create recv transport only once, reuse for all consumers
    if (!recvTransportRef.current) {
      const { transportParams, error } = await new Promise<any>((resolve) =>
        socket.emit("createTransport", { direction: "recv" }, resolve),
      );
      if (error) throw new Error(error);

      const transport = device.createRecvTransport(transportParams);
      recvTransportRef.current = transport;

      transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        try {
          await new Promise<void>((resolve, reject) => {
            socket.emit(
              "connectTransport",
              { direction: "recv", dtlsParameters },
              ({ error }: any) =>
                error ? reject(new Error(error)) : resolve(),
            );
          });
          callback();
        } catch (err: any) {
          errback(err);
        }
      });
    }

    const { consumerParams, error } = await new Promise<any>((resolve) =>
      socket.emit(
        "consume",
        { producerSocketId, rtpCapabilities: device.recvRtpCapabilities },
        resolve,
      ),
    );
    if (error) throw new Error(error);

    const tracks: MediaStreamTrack[] = [];

    if (consumerParams.video) {
      const videoConsumer = await recvTransportRef.current!.consume(
        consumerParams.video,
      );
      consumersRef.current.set(videoConsumer.id, videoConsumer);
      tracks.push(videoConsumer.track);
    }
    if (consumerParams.audio) {
      const audioConsumer = await recvTransportRef.current!.consume(
        consumerParams.audio,
      );
      consumersRef.current.set(audioConsumer.id, audioConsumer);
      tracks.push(audioConsumer.track);
    }

    if (tracks.length > 0) {
      addRemotePeer(producerSocketId);

      // Wait for React to mount the <video> element, then attach stream
      setTimeout(() => {
        const videoEl = remoteVideoRefs.current.get(producerSocketId);
        if (videoEl) {
          videoEl.srcObject = new MediaStream(tracks);
          videoEl.play().catch(console.error);
        }
      }, 200);
    }
  }

  // ── main init ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    socket.on("producerClosed", ({ producerSocketId }: any) => {
      removeRemotePeer(producerSocketId);
    });

    async function init() {
      try {
        setStatus("loading-device");

        // joinRoom returns rtpCapabilities directly
        const { rtpCapabilities, error: joinError } = await new Promise<any>(
          (resolve) => socket.emit("joinRoom", { roomId }, resolve),
        );
        if (joinError) throw new Error(joinError);

        const device = await loadDevice(rtpCapabilities);
        if (cancelled) return;
        deviceRef.current = device;

        setStatus("getting-camera");
        const stream = await getLocalStream();
        if (cancelled) return;

        await createSendTransport(device, stream);
        if (cancelled) return;

        setStatus("streaming");

        // Consume any peers already in the room
        const { producerSocketIds } = await new Promise<any>((resolve) =>
          socket.emit("getProducers", resolve),
        );
        for (const producerSocketId of producerSocketIds) {
          if (!cancelled) await consumeRemoteProducer(device, producerSocketId);
        }

        // Listen for new peers joining
        socket.on("newProducer", async ({ producerSocketId }: any) => {
          if (!cancelled) await consumeRemoteProducer(device, producerSocketId);
        });
      } catch (err: any) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(err.message);
        }
      }
    }

    init();

    return () => {
      cancelled = true;

      socket.emit("leaveRoom");

      producerRef.current?.close();
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      consumersRef.current.forEach((c) => c.close());

      socket.off("newProducer");
      socket.off("producerClosed");
    };
  }, [roomId]);

  return {
    status,
    errorMsg,
    remotePeers,
    localVideoRef,
    remoteVideoRefs,
  };
}
