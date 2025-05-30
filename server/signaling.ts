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

  // Проверяем, что функция вызывается
  signalingLogger.log(`Registering mediasoup signaling events for socket: ${socket.id}`, {
    socketId: socket.id, 
    registeredEvents: Array.from(socket.eventNames())
  }, true);
  
  // Явно проверяем, что наши обработчики регистрируются
  socket.on('debug-events', (callback) => {
    if (typeof callback === 'function') {
      callback({
        socketId: socket.id,
        currentEvents: Array.from(socket.eventNames()),
        participantId: participantId
      });
    }
  });
  
  // Тестируем прослушивает ли сокет событие join-room
  socket.on('test-join-room', (data, callback) => {
    signalingLogger.log('Got test-join-room event', data, true);
    if (typeof callback === 'function') {
      callback({ success: true, message: 'join-room handler registered correctly' });
    }
  });

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
      // Add detailed logging for debugging
      signalingLogger.log(`Join room request: ${JSON.stringify(request)}`, null, true);
      
      // Store the userId as the participantId for this socket connection
      participantId = request.userId;

      // Также сохраняем ID пользователя в данных сокета для определения активных соединений
      socket.data.participantId = request.userId;
      socket.data.userId = request.userId;
      socket.data.nickname = request.nickname;
      
      signalingLogger.log(`Set participantId to ${participantId} for socket ${socket.id}`, null, true);
      
      // Выводим информацию о всех активных соединениях для отладки
      const activeSockets = Array.from(io.sockets.sockets.values());
      signalingLogger.log(`Active connections: ${activeSockets.length}`, 
        activeSockets.map(s => ({ 
          id: s.id, 
          participantId: s.data.participantId,
          connected: s.connected
        })), true
      );
      
      // Получаем имя комнаты до добавления участника
      const roomName = mafiaRoom.getRoomName();
      
      // Проверяем, уже в комнате ли сокет
      const isInRoom = socket.rooms.has(roomName);
      if (isInRoom) {
        signalingLogger.log(`Socket ${socket.id} already in room ${roomName}`, null, true);
      }
      
      // Проверяем, существует ли уже этот участник в комнате
      // Это важно, так как joinRoom в routes.ts уже мог добавить участника
      const existingParticipant = mafiaRoom.getParticipants().get(request.userId);
      
      let participant;
      if (existingParticipant) {
        signalingLogger.log(`Participant ${request.userId} already exists in mafiaRoom, using existing`, existingParticipant, true);
        participant = existingParticipant;
      } else {
        // Добавляем участника только если его ещё нет
        signalingLogger.log(`Adding new participant ${request.userId} to mafiaRoom`, null, true);
        participant = await mafiaRoom.addParticipant(request.userId, request.nickname);
        signalingLogger.log(`Added participant: ${JSON.stringify(participant)}`, null, true);
      }
      
      // Join the socket to the room - обеспечиваем присоединение к комнате Socket.IO
      if (!isInRoom) {
        socket.join(roomName);
        signalingLogger.log(`Socket ${socket.id} joined room ${roomName}`, null, true);
      }
      
      // Send the current participants to the new participant
      const participants = mafiaRoom.getParticipantsInfo();
      signalingLogger.log(`Current participants: ${JSON.stringify(participants)}`, null, true);
      
      // Проверяем, есть ли функция обратного вызова
      if (typeof callback !== 'function') {
        signalingLogger.error(`No callback function provided for join-room! This is critical for MediaSoup flow!`, {
          socketId: socket.id,
          userId: request.userId
        });
        return;
      }
      
      callback({
        success: true,
        participants: participants
      });
      
      // Inform other participants in the room through a Socket.IO broadcast
      socket.to(roomName).emit('participant-joined', {
        id: participant.id,
        nickname: participant.nickname,
        position: participant.position,
        hasVideo: participant.hasVideo
      });

      signalingLogger.log(`Participant ${request.userId} joined the room successfully and others were notified`, null, true);
      
      // Проверяем, доставлено ли уведомление другим клиентам
      setTimeout(() => {
        const roomMembers = io.sockets.adapter.rooms.get(roomName);
        signalingLogger.log(`Socket room membership check:`, {
          roomName: roomName,
          socketCount: roomMembers?.size || 0,
          socketIds: Array.from(roomMembers || new Set())
        });
      }, 500);
    } catch (error) {
      signalingLogger.error(`Error in join-room handler:`, error);
      // Проверяем, есть ли функция обратного вызова
      if (typeof callback === 'function') {
        callback(handleError('Error joining room', error));
      } else {
        signalingLogger.error(`Cannot send error to client - no callback function!`, {
          socketId: socket.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });

  // Get router RTP capabilities
  socket.on('get-rtp-capabilities', (request: GetRtpCapabilitiesRequest, callback) => {
    try {
      // Log details for debugging
      signalingLogger.log(`Received RTP capabilities request for user ${request.userId}`, request, true);
      
      // Проверяем, есть ли функция обратного вызова
      if (typeof callback !== 'function') {
        signalingLogger.error(`No callback function provided for get-rtp-capabilities! This is critical for MediaSoup flow!`, {
          socketId: socket.id,
          userId: request.userId
        });
        return;
      }
      
      // Get router capabilities
      const rtpCapabilities = getRouterRtpCapabilities();
      signalingLogger.log(`Sending RTP capabilities:`, { success: true, userId: request.userId }, true);
      
      // Return capabilities
      callback({
        success: true,
        rtpCapabilities
      });
    } catch (error) {
      signalingLogger.error(`Error in get-rtp-capabilities handler:`, error);
      // Проверяем, есть ли функция обратного вызова
      if (typeof callback === 'function') {
        callback(handleError('Error getting RTP capabilities', error));
      } else {
        signalingLogger.error(`Cannot send error to client - no callback function!`, {
          socketId: socket.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });

  // Create WebRTC transport
  socket.on('create-transport', async (request: CreateTransportRequest, callback) => {
    try {
      // Log the request for debugging
      signalingLogger.log(`Create transport request: ${JSON.stringify(request)}`, null, true);
      signalingLogger.log(`Current participantId: ${participantId}`, null, true);
      
      // Temporarily disable ID check for debugging
      // if (request.userId !== participantId) {
      //   throw new Error('User ID mismatch');
      // }
      
      // Set participantId if not already set (for robustness)
      if (!participantId) {
        participantId = request.userId;
        signalingLogger.log(`Setting participantId to ${participantId} from transport request`, null, true);
      }

      let transportData;
      if (request.direction === 'send') {
        transportData = await mafiaRoom.createProducerTransport(request.userId);
        signalingLogger.log(`Created producer transport for ${request.userId}`, null, true);
      } else {
        transportData = await mafiaRoom.createConsumerTransport(request.userId);
        signalingLogger.log(`Created consumer transport for ${request.userId}`, null, true);
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
      // Log for debugging
      signalingLogger.log(`Connect transport request: ${JSON.stringify(request)}`, null, true);
      signalingLogger.log(`Current participantId: ${participantId}`, null, true);
      
      // Temporarily disable ID check for debugging
      // if (request.userId !== participantId) {
      //   throw new Error('User ID mismatch');
      // }
      
      // Set participantId if not already set (for robustness)
      if (!participantId) {
        participantId = request.userId;
        signalingLogger.log(`Setting participantId to ${participantId} from connect-transport request`, null, true);
      }

      if (request.direction === 'send') {
        await mafiaRoom.connectProducerTransport(request.userId, request.dtlsParameters);
        signalingLogger.log(`Connected producer transport for ${request.userId}`, null, true);
      } else {
        await mafiaRoom.connectConsumerTransport(request.userId, request.dtlsParameters);
        signalingLogger.log(`Connected consumer transport for ${request.userId}`, null, true);
      }

      callback({ success: true });
    } catch (error) {
      callback(handleError('Error connecting transport', error));
    }
  });

  // Produce (send media)
  socket.on('produce', async (request: ProduceRequest, callback) => {
    try {
      // Log for debugging
      signalingLogger.log(`Produce request: ${JSON.stringify(request)}`, null, true);
      signalingLogger.log(`Current participantId: ${participantId}`, null, true);
      
      // Temporarily disable ID check for debugging
      // if (request.userId !== participantId) {
      //   throw new Error('User ID mismatch');
      // }
      
      // Set participantId if not already set (for robustness)
      if (!participantId) {
        participantId = request.userId;
        signalingLogger.log(`Setting participantId to ${participantId} from produce request`, null, true);
      }

      const producerId = await mafiaRoom.createProducer(
        request.userId,
        request.kind,
        request.rtpParameters
      );
      signalingLogger.log(`Created producer for ${request.userId}: ${producerId}`, null, true);

      // Update video status
      mafiaRoom.updateParticipantVideo(request.userId, true);
      signalingLogger.log(`Updated video status for ${request.userId} to true`, null, true);

      // Notify all participants about the video status change
      io.to(mafiaRoom.getRoomName()).emit('video-status-changed', {
        participantId: request.userId,
        hasVideo: true
      });
      signalingLogger.log(`Notified room about video status change for ${request.userId}`, null, true);

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
      // Log for debugging
      signalingLogger.log(`Consume request: ${JSON.stringify(request)}`, null, true);
      signalingLogger.log(`Current participantId: ${participantId}`, null, true);
      
      // Temporarily disable ID check for debugging
      // if (request.userId !== participantId) {
      //   throw new Error('User ID mismatch');
      // }
      
      // Set participantId if not already set (for robustness)
      if (!participantId) {
        participantId = request.userId;
        signalingLogger.log(`Setting participantId to ${participantId} from consume request`, null, true);
      }

      const consumer = await mafiaRoom.createConsumer(
        request.userId,
        request.producerParticipantId
      );
      signalingLogger.log(`Created consumer for ${request.userId} to consume ${request.producerParticipantId}`, null, true);

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
      // Log for debugging
      signalingLogger.log(`Consume-all request: ${JSON.stringify(request)}`, null, true);
      signalingLogger.log(`Current participantId: ${participantId}`, null, true);
      
      // Temporarily disable ID check for debugging
      // if (request.userId !== participantId) {
      //   throw new Error('User ID mismatch');
      // }
      
      // Set participantId if not already set (for robustness)
      if (!participantId) {
        participantId = request.userId;
        signalingLogger.log(`Setting participantId to ${participantId} from consume-all request`, null, true);
      }

      const consumers = await mafiaRoom.createConsumersForNewParticipant(
        request.userId,
        request.rtpCapabilities
      );
      signalingLogger.log(`Created ${consumers.length} consumers for ${request.userId}`, null, true);

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
      // Log for debugging
      signalingLogger.log(`Update position request: ${JSON.stringify(request)}`, null, true);
      signalingLogger.log(`Current participantId: ${participantId}`, null, true);
      
      // Temporarily disable ID check for debugging
      // if (request.userId !== participantId) {
      //   throw new Error('User ID mismatch');
      // }
      
      // Set participantId if not already set (for robustness)
      if (!participantId) {
        participantId = request.userId;
        signalingLogger.log(`Setting participantId to ${participantId} from update-position request`, null, true);
      }

      const success = mafiaRoom.updateParticipantPosition(
        request.userId,
        request.position
      );
      signalingLogger.log(`Updated position for ${request.userId} to ${request.position}: ${success}`, null, true);

      if (success) {
        // Notify all participants about the position change
        const participants = mafiaRoom.getParticipantsInfo();
        io.to(mafiaRoom.getRoomName()).emit('positions-updated', participants);
        signalingLogger.log(`Notified room of position updates: ${JSON.stringify(participants)}`, null, true);
      }

      callback({ success });
    } catch (error) {
      callback(handleError('Error updating position', error));
    }
  });

  // Update multiple positions at once
  socket.on('update-positions', (request: UpdatePositionsRequest, callback) => {
    try {
      // Log for debugging
      signalingLogger.log(`Update positions request: ${JSON.stringify(request)}`, null, true);

      const success = mafiaRoom.updatePositions(request.positionUpdates);
      signalingLogger.log(`Updated multiple positions: ${success}`, null, true);

      if (success) {
        // Notify all participants about the position changes
        const participants = mafiaRoom.getParticipantsInfo();
        io.to(mafiaRoom.getRoomName()).emit('positions-updated', participants);
        signalingLogger.log(`Notified room of position updates: ${JSON.stringify(participants)}`, null, true);
      }

      callback({ success });
    } catch (error) {
      callback(handleError('Error updating multiple positions', error));
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    if (participantId) {
      signalingLogger.log(`Socket ${socket.id} disconnected, participant: ${participantId}`, null, true);
      
      // Проверка на переподключение - даем пользователю время переподключиться
      // перед тем как удалять его из комнаты
      setTimeout(async () => {
        // Проверяем, нет ли других активных соединений с тем же participantId
        const isStillActive = Array.from(io.sockets.sockets.values())
          .some(s => s.id !== socket.id && (s.data.participantId === participantId || s.data.userId === participantId));
        
        if (!isStillActive) {
          signalingLogger.log(`No active connections for ${participantId}, removing from room`, null, true);
          await mafiaRoom.removeParticipant(participantId);
          
          // Notify remaining participants
          io.to(mafiaRoom.getRoomName()).emit('participant-left', {
            participantId
          });
          
          signalingLogger.log(`Participant ${participantId} fully removed from room`, null, true);
        } else {
          signalingLogger.log(`Participant ${participantId} has other connections, not removing`, null, true);
        }
      }, 5000); // Дать 5 секунд на возможное переподключение
    }
  });
}