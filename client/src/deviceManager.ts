import { Device } from "mediasoup-client";
import type { RtpCapabilities } from "mediasoup-client/types";

let device: Device | null = null;

export async function loadDevice(
  rtpCapabilities: RtpCapabilities,
): Promise<Device> {
  device = new Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });
  return device;
}

export function getDevice(): Device | null {
  return device;
}
