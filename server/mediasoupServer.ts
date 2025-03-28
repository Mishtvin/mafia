import * as mediasoup from 'mediasoup';
import { types } from 'mediasoup';
import { createLogger } from './logger';

const mediasoupLogger = createLogger('mediasoup');

// Global variables
let mediasoupWorker: mediasoup.types.Worker;
let mediasoupRouter: mediasoup.types.Router;

// mediasoup server settings
const config = {
  // mediasoup Worker settings
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp'
    ],
  },
  // mediasoup Router settings
  router: {
    mediaCodecs: [
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000
        }
      }
    ]
  },
  // WebRtcTransport settings
  webRtcTransport: {
    listenIps: [
      { ip: '0.0.0.0', announcedIp: null } // Replace with server IP address in production
    ],
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
    maxIncomingBitrate: 1500000
  }
};

/**
 * Initialize mediasoup worker and router
 */
export async function initializeMediasoup(): Promise<types.Router> {
  try {
    mediasoupLogger.log('Creating mediasoup worker...');
    mediasoupWorker = await mediasoup.createWorker({
      logLevel: config.worker.logLevel as types.WorkerLogLevel,
      logTags: config.worker.logTags as types.WorkerLogTag[],
      rtcMinPort: config.worker.rtcMinPort,
      rtcMaxPort: config.worker.rtcMaxPort,
    });

    mediasoupWorker.on('died', () => {
      mediasoupLogger.log('mediasoup worker died, exiting process...');
      process.exit(1);
    });

    mediasoupLogger.log('Creating mediasoup router...');
    mediasoupRouter = await mediasoupWorker.createRouter({
      mediaCodecs: config.router.mediaCodecs as types.RtpCodecCapability[]
    });

    mediasoupLogger.log('mediasoup initialized successfully!');
    return mediasoupRouter;
  } catch (error) {
    mediasoupLogger.error('mediasoup initialization error', error);
    throw error;
  }
}

/**
 * Create a WebRTC transport for sending or receiving
 */
export async function createWebRtcTransport(): Promise<types.WebRtcTransport> {
  try {
    const transport = await mediasoupRouter.createWebRtcTransport({
      listenIps: config.webRtcTransport.listenIps.map(ip => ({
        ip: ip.ip,
        announcedIp: ip.announcedIp || undefined
      })) as types.TransportListenIp[],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: config.webRtcTransport.initialAvailableOutgoingBitrate
    });

    // Set max bitrate if specified
    if (config.webRtcTransport.maxIncomingBitrate) {
      await transport.setMaxIncomingBitrate(config.webRtcTransport.maxIncomingBitrate);
    }

    return transport;
  } catch (error) {
    mediasoupLogger.error('Error creating WebRTC transport', error);
    throw error;
  }
}

/**
 * Get mediasoup router capabilities
 */
export function getRouterRtpCapabilities(): types.RtpCapabilities {
  return mediasoupRouter.rtpCapabilities;
}

/**
 * Get the mediasoup router
 */
export function getRouter(): types.Router {
  return mediasoupRouter;
}