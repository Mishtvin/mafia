import { Socket, Server as SocketIOServer } from 'socket.io';
import { types } from 'mediasoup';
import { mafiaRoom } from './mafiaRoom';
import { getRouterRtpCapabilities } from './mediasoupServer';
import { createLogger } from './logger';

const signalingLogger = createLogger('signaling');

// Types for WebRTC signaling messages
interface JoinRoomRequest {
  userId: string;
  nickname: string;
}

interface GetRtpCapabilitiesRequest {
  userId: string;
}

interface CreateTransportRequest {
  userId: string;
  direction: 'send' | 'receive';
}

interface ConnectTransportRequest {
  userId: string;
  transportId: string;
  dtlsParameters: types.DtlsParameters;
  direction: 'send' | 'receive';
}

interface ProduceRequest {
  userId: string;
  transportId: string;
  kind: 'video';
  rtpParameters: types.RtpParameters;
}

interface ConsumeRequest {
  userId: string;
  producerParticipantId: string;
  rtpCapabilities: types.RtpCapabilities;
}

interface UpdatePositionRequest {
  userId: string;
  position: number;
}

interface UpdatePositionsRequest {
  positionUpdates: { id: string, position: number }[];
}

/**
 * Register WebRTC signaling events for a socket
 */
export function registerSignalingEvents(io: SocketIOServer, socket: Socket): void {
  let participantId = '';

  // Handle connection
  signalingLogger.log(`New connection: ${socket.id}`);
  
  // For error handling in callbacks
  const handleError = (context: string, error: unknown) => {
    signalingLogger.error(`${context}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  };

  // Join the room
  socket.on('join-room', async (request: JoinRoomRequest, callback) => {
    try {
      participantId = request.userId;
      const participant = await mafiaRoom.addParticipant(request.userId, request.nickname);
      
      // Join the socket to the room
      socket.join(mafiaRoom.getRoomName());
      
      // Send the current participants to the new participant
      callback({
        success: true,
        participants: mafiaRoom.getParticipantsInfo()
      });
      
      // Notify all other participants
      socket.to(mafiaRoom.getRoomName()).emit('participant-joined', {
        id: participant.id,
        nickname: participant.nickname,
        position: participant.position,
        hasVideo: participant.hasVideo
      });

      signalingLogger.log(`Participant ${request.userId} joined the room`);
    } catch (error) {
      callback(handleError('Error joining room', error));
    }
  });

  // Get router RTP capabilities
  socket.on('get-rtp-capabilities', (request: GetRtpCapabilitiesRequest, callback) => {
    try {
      if (request.userId !== participantId) {
        throw new Error('User ID mismatch');
      }

      const rtpCapabilities = getRouterRtpCapabilities();
      callback({
        success: true,
        rtpCapabilities
      });
    } catch (error) {
      callback(handleError('Error getting RTP capabilities', error));
    }
  });

  // Create WebRTC transport
  socket.on('create-transport', async (request: CreateTransportRequest, callback) => {
    try {
      if (request.userId !== participantId) {
        throw new Error('User ID mismatch');
      }

      let transportData;
      if (request.direction === 'send') {
        transportData = await mafiaRoom.createProducerTransport(request.userId);
      } else {
        transportData = await mafiaRoom.createConsumerTransport(request.userId);
      }

      callback({
        success: true,
        transport: transportData
      });
    } catch (error) {
      callback(handleError('Error creating transport', error));
    }
  });

  // Connect transport
  socket.on('connect-transport', async (request: ConnectTransportRequest, callback) => {
    try {
      if (request.userId !== participantId) {
        throw new Error('User ID mismatch');
      }

      if (request.direction === 'send') {
        await mafiaRoom.connectProducerTransport(request.userId, request.dtlsParameters);
      } else {
        await mafiaRoom.connectConsumerTransport(request.userId, request.dtlsParameters);
      }

      callback({ success: true });
    } catch (error) {
      callback(handleError('Error connecting transport', error));
    }
  });

  // Produce (send media)
  socket.on('produce', async (request: ProduceRequest, callback) => {
    try {
      if (request.userId !== participantId) {
        throw new Error('User ID mismatch');
      }

      const producerId = await mafiaRoom.createProducer(
        request.userId,
        request.kind,
        request.rtpParameters
      );

      // Update video status
      mafiaRoom.updateParticipantVideo(request.userId, true);

      // Notify all participants about the video status change
      io.to(mafiaRoom.getRoomName()).emit('video-status-changed', {
        participantId: request.userId,
        hasVideo: true
      });

      callback({
        success: true,
        producerId
      });
    } catch (error) {
      callback(handleError('Error producing', error));
    }
  });

  // Consume (receive media)
  socket.on('consume', async (request: ConsumeRequest, callback) => {
    try {
      if (request.userId !== participantId) {
        throw new Error('User ID mismatch');
      }

      const consumer = await mafiaRoom.createConsumer(
        request.userId,
        request.producerParticipantId
      );

      if (!consumer) {
        throw new Error('Could not create consumer');
      }

      callback({
        success: true,
        consumer
      });
    } catch (error) {
      callback(handleError('Error consuming', error));
    }
  });

  // Create all consumers for a new participant
  socket.on('consume-all', async (request: { userId: string, rtpCapabilities: types.RtpCapabilities }, callback) => {
    try {
      if (request.userId !== participantId) {
        throw new Error('User ID mismatch');
      }

      const consumers = await mafiaRoom.createConsumersForNewParticipant(
        request.userId,
        request.rtpCapabilities
      );

      callback({
        success: true,
        consumers
      });
    } catch (error) {
      callback(handleError('Error consuming all producers', error));
    }
  });

  // Update position
  socket.on('update-position', (request: UpdatePositionRequest, callback) => {
    try {
      if (request.userId !== participantId) {
        throw new Error('User ID mismatch');
      }

      const success = mafiaRoom.updateParticipantPosition(
        request.userId,
        request.position
      );

      if (success) {
        // Notify all participants about the position change
        io.to(mafiaRoom.getRoomName()).emit('positions-updated', mafiaRoom.getParticipantsInfo());
      }

      callback({ success });
    } catch (error) {
      callback(handleError('Error updating position', error));
    }
  });

  // Update multiple positions at once
  socket.on('update-positions', (request: UpdatePositionsRequest, callback) => {
    try {
      const success = mafiaRoom.updatePositions(request.positionUpdates);

      if (success) {
        // Notify all participants about the position changes
        io.to(mafiaRoom.getRoomName()).emit('positions-updated', mafiaRoom.getParticipantsInfo());
      }

      callback({ success });
    } catch (error) {
      callback(handleError('Error updating multiple positions', error));
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    if (participantId) {
      try {
        await mafiaRoom.removeParticipant(participantId);
        
        // Notify all participants
        io.to(mafiaRoom.getRoomName()).emit('participant-left', { participantId });
        
        signalingLogger.log(`Participant ${participantId} left the room`);
      } catch (error) {
        signalingLogger.error(`Error removing participant`, error);
      }
    }
  });
}