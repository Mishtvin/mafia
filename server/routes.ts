import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { storage } from "./storage";
import { z } from "zod";
import { 
  joinRoomMessageSchema, 
  leaveRoomMessageSchema,
  videoStatusMessageSchema,
  positionUpdateSchema
} from "@shared/schema";
import { connectionStatusSchema } from "@shared/registerEvents";
import { 
  socketLogger, 
  roomLogger, 
  connectionLogger,
  logError 
} from "./logger";
import { initializeMediasoup } from "./mediasoupServer";
import { registerSignalingEvents } from "./signaling";
import { VideoStreamManager } from "./videoHandler";
// MediaSoup implementation now replaces the old video streaming code

// Interface for WebRTC signaling data (kept for compatibility)
interface WebRTCSignalingData {
  type: 'webrtc';
  action: 'offer' | 'answer' | 'ice-candidate';
  sender: string;
  receiver: string;
  roomToken: string;
  payload: any;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Create Socket.IO server with CORS and automatic reconnection
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    pingInterval: 10000,
    pingTimeout: 5000,
    maxHttpBufferSize: 1e8 // Increase buffer size for video chunks (100MB)
  });
  
  // Initialize mediasoup
  try {
    await initializeMediasoup();
    console.log('mediasoup initialized successfully');
  } catch (error) {
    console.error('Failed to initialize mediasoup:', error);
    process.exit(1);
  }
  
  // Create video stream manager
  const videoManager = new VideoStreamManager(io);
  
  // Map to track socket connections by room and user ID
  const rooms = new Map<string, Map<string, string>>(); // roomToken -> Map<userId, socketId>
  
  // API Route: Create a new room
  app.post('/api/rooms', async (req, res) => {
    try {
      const room = await storage.createRoom();
      roomLogger.log('Room created', { token: room.token });
      res.status(201).json({ 
        token: room.token,
        createdAt: room.createdAt
      });
    } catch (error) {
      logError('Error creating room', error);
      res.status(500).json({ message: 'Error creating room' });
    }
  });
  
  // API Route: Get room info
  app.get('/api/rooms/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const room = await storage.getRoom(token);
      
      if (!room) {
        roomLogger.log('Room not found', { token });
        return res.status(404).json({ message: 'Room not found' });
      }
      
      const participants = await storage.getParticipantsByRoom(room.id);
      
      roomLogger.log('Room info requested', { 
        token: room.token, 
        participantCount: participants.length 
      });
      
      res.status(200).json({
        token: room.token,
        participants: participants.map(p => ({
          userId: p.userId,
          nickname: p.nickname,
          position: p.position,
          hasVideo: p.hasVideo
        }))
      });
    } catch (error) {
      logError('Error getting room', error);
      res.status(500).json({ message: 'Error getting room' });
    }
  });
  
  // Socket.IO connection handler
  io.on('connection', (socket: Socket) => {
    socketLogger.log('Client connected', { socketId: socket.id });
    
    // Send immediate welcome message to establish connection as stable
    socket.emit('welcome', { message: 'Connected to Socket.IO server' });
    
    // Register mediasoup signaling events
    registerSignalingEvents(io, socket);
    
    // Test handlers for debugging purposes
    socket.on('active-handlers', (callback) => {
      if (typeof callback === 'function') {
        const handlers = Array.from(socket.eventNames());
        socketLogger.log('Received active-handlers request', { 
          socketId: socket.id, 
          handlers 
        });
        callback({ 
          socketId: socket.id,
          handlers: handlers,
          serverTime: new Date().toISOString()
        });
      }
    });
    
    // Test specific handlers
    socket.on('test-handlers', (data, callback) => {
      if (typeof callback === 'function') {
        const result: Record<string, boolean> = {};
        const events = data?.events || [];
        
        socketLogger.log('Testing handlers availability', { 
          socketId: socket.id, 
          events 
        });
        
        for (const event of events) {
          const hasHandler = socket.eventNames().includes(event);
          result[event] = hasHandler;
        }
        
        callback({
          result,
          all: Array.from(socket.eventNames())
        });
      }
    });
    
    // Register video stream handlers (legacy)
    videoManager.registerHandlers(socket);
    
    let currentRoomToken: string | null = null;
    let currentUserId: string | null = null;
    
    // Handle join room event
    socket.on('joinRoom', async (data, callback) => {
      try {
        if (!joinRoomMessageSchema.safeParse(data).success) {
          roomLogger.log(`Invalid join room data`, { data });
          socket.emit('error', { message: 'Invalid join room data' });
          return;
        }
        
        const { roomToken, nickname, userId } = data;
        currentRoomToken = roomToken;
        currentUserId = userId;
        
        roomLogger.log(`User joining room via joinRoom event`, { 
          userId, 
          nickname, 
          roomToken,
          socketId: socket.id,
          hasCallback: typeof callback === 'function'
        });
        
        // Socket.IO join room
        socket.join(roomToken);
        
        // Store user and room info
        if (!rooms.has(roomToken)) {
          rooms.set(roomToken, new Map());
          roomLogger.log(`Created new room tracking`, { roomToken });
        }
        
        const roomUsers = rooms.get(roomToken)!;
        roomUsers.set(userId, socket.id);
        roomLogger.log(`Room user count updated`, { 
          roomToken, 
          userCount: roomUsers.size 
        });
        
        // Get room
        const room = await storage.getRoom(roomToken);
        if (!room) {
          roomLogger.log(`Room not found: ${roomToken}`);
          socket.emit('error', { message: 'Room not found' });
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Room not found' });
          }
          return;
        }
        
        // Find first available position
        const participants = await storage.getParticipantsByRoom(room.id);
        const positions = new Set(participants.map(p => p.position));
        let position = 0;
        while (positions.has(position) && position < 12) {
          position++;
        }
        
        if (position >= 12) {
          socket.emit('error', { message: 'Room is full' });
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Room is full' });
          }
          return;
        }
        
        // Check if participant already exists (rejoining)
        const existingParticipant = await storage.getParticipant(room.id, userId);
        
        if (existingParticipant) {
          roomLogger.log(`User rejoining room`, { userId, roomToken });
          // Update the existing participant instead of creating a new one
          // No need to do anything as the participant is already in the DB
        } else {
          // Add participant to room
          await storage.addParticipant({
            roomId: room.id,
            userId,
            nickname,
            position,
            hasVideo: true,
            joinedAt: Math.floor(Date.now() / 1000)
          });
          roomLogger.log(`Added new participant`, { 
            userId, 
            roomToken, 
            position 
          });
        }
        
        // Get updated participants
        const updatedParticipants = await storage.getParticipantsByRoom(room.id);
        roomLogger.log(`Room participants`, { 
          roomToken, 
          count: updatedParticipants.length 
        });
        
        // First, send the room state to the newly joined user
        socket.emit('roomUpdate', {
          participants: updatedParticipants.map(p => ({
            userId: p.userId,
            nickname: p.nickname,
            position: p.position,
            hasVideo: p.hasVideo
          }))
        });
        
        // Then broadcast the update to everyone in the room (including the new user)
        io.to(roomToken).emit('roomUpdate', {
          participants: updatedParticipants.map(p => ({
            userId: p.userId,
            nickname: p.nickname,
            position: p.position,
            hasVideo: p.hasVideo
          }))
        });
        
        roomLogger.log(`Room update broadcast complete`, { 
          roomToken, 
          participantCount: updatedParticipants.length 
        });
        
        // Call the callback if provided to acknowledge success
        if (typeof callback === 'function') {
          roomLogger.log('Sending joinRoom callback confirmation for user', { userId, socketId: socket.id });
          callback({ success: true });
        } else {
          roomLogger.log('No callback function provided for joinRoom event', { userId, socketId: socket.id });
          // Fallback for older clients that might be using emit/on pattern
          socket.emit('joinRoomResponse', { success: true });
        }
      } catch (error) {
        logError('Error joining room', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });
    
    // Handle leave room event
    socket.on('leaveRoom', async (data) => {
      try {
        if (!leaveRoomMessageSchema.safeParse(data).success) {
          socket.emit('error', { message: 'Invalid leave room data' });
          return;
        }
        
        const { roomToken, userId } = data;
        
        // Get room
        const room = await storage.getRoom(roomToken);
        if (!room) return;
        
        // Remove participant from room
        await storage.removeParticipant(room.id, userId);
        
        // Remove client from room users
        const roomUsers = rooms.get(roomToken);
        if (roomUsers) {
          roomUsers.delete(userId);
          
          // If room is empty, remove room
          if (roomUsers.size === 0) {
            rooms.delete(roomToken);
          }
        }
        
        // Socket.IO leave room
        socket.leave(roomToken);
        
        // Get updated participants
        const updatedParticipants = await storage.getParticipantsByRoom(room.id);
        
        // Broadcast room update to all clients
        io.to(roomToken).emit('roomUpdate', {
          participants: updatedParticipants.map(p => ({
            userId: p.userId,
            nickname: p.nickname,
            position: p.position,
            hasVideo: p.hasVideo
          }))
        });
        
        roomLogger.log(`User left room`, { userId, roomToken });
      } catch (error) {
        logError('Error leaving room', error);
        socket.emit('error', { message: 'Failed to leave room' });
      }
    });
    
    // Handle video status update
    socket.on('videoStatus', async (data) => {
      try {
        if (!videoStatusMessageSchema.safeParse(data).success) {
          socket.emit('error', { message: 'Invalid video status data' });
          return;
        }
        
        const { roomToken, userId, hasVideo } = data;
        
        // Get room
        const room = await storage.getRoom(roomToken);
        if (!room) return;
        
        // Get participant
        const participant = await storage.getParticipant(room.id, userId);
        if (!participant) return;
        
        // Update participant video status
        await storage.updateParticipantVideo(participant.id, hasVideo);
        
        // Get updated participants
        const updatedParticipants = await storage.getParticipantsByRoom(room.id);
        
        // Broadcast room update to all clients
        io.to(roomToken).emit('roomUpdate', {
          participants: updatedParticipants.map(p => ({
            userId: p.userId,
            nickname: p.nickname,
            position: p.position,
            hasVideo: p.hasVideo
          }))
        });
        
        roomLogger.log(`Video status updated`, { userId, roomToken, hasVideo });
      } catch (error) {
        logError('Error updating video status', error);
        socket.emit('error', { message: 'Failed to update video status' });
      }
    });
    
    // Handle position update
    socket.on('updatePositions', async (data) => {
      try {
        if (!positionUpdateSchema.safeParse(data).success) {
          socket.emit('error', { message: 'Invalid position update data' });
          return;
        }
        
        const { roomToken, positions } = data;
        
        // Get room
        const room = await storage.getRoom(roomToken);
        if (!room) return;
        
        // Update participant positions
        await storage.updatePositions(room.id, positions);
        
        // Get updated participants
        const updatedParticipants = await storage.getParticipantsByRoom(room.id);
        
        // Broadcast room update to all clients
        io.to(roomToken).emit('roomUpdate', {
          participants: updatedParticipants.map(p => ({
            userId: p.userId,
            nickname: p.nickname,
            position: p.position,
            hasVideo: p.hasVideo
          }))
        });
        
        roomLogger.log(`Positions updated`, { 
          roomToken, 
          updatedCount: positions.length 
        });
      } catch (error) {
        logError('Error updating positions', error);
        socket.emit('error', { message: 'Failed to update positions' });
      }
    });
    
    // Handle WebRTC signaling
    socket.on('webrtc', (data: WebRTCSignalingData) => {
      try {
        const { roomToken, receiver, sender } = data;
        
        // Get the socket ID of the receiver
        const roomUsers = rooms.get(roomToken);
        if (!roomUsers) return;
        
        const receiverSocketId = roomUsers.get(receiver);
        if (!receiverSocketId) return;
        
        // Forward the signaling data to the receiver
        io.to(receiverSocketId).emit('webrtc', data);
        
        // Only log occasionally to reduce noise
        if (Math.random() < 0.1) { // 10% chance to log
          socketLogger.log(`WebRTC signaling`, { 
            sender, 
            receiver, 
            action: data.action 
          });
        }
      } catch (error) {
        logError('Error processing WebRTC signaling', error);
      }
    });
    
    // Handle user connection status events
    socket.on('userConnected', (data) => {
      try {
        if (!connectionStatusSchema.safeParse(data).success) {
          socket.emit('error', { message: 'Invalid connection status data' });
          return;
        }
        
        const { userId, roomToken, connected, nickname } = data;
        
        connectionLogger.log(`User connection status changed`, { 
          userId, 
          roomToken, 
          connected, 
          nickname 
        });
        
        // Broadcast to room
        socket.to(roomToken).emit('userConnected', data);
      } catch (error) {
        logError('Error handling user connection status', error);
        socket.emit('error', { message: 'Failed to process connection status' });
      }
    });
    
    // Handle user disconnection events
    socket.on('userDisconnected', (data) => {
      try {
        if (!connectionStatusSchema.safeParse(data).success) {
          socket.emit('error', { message: 'Invalid connection status data' });
          return;
        }
        
        const { userId, roomToken } = data;
        
        connectionLogger.log(`User manually disconnected`, { userId, roomToken });
        
        // Broadcast to room
        socket.to(roomToken).emit('userDisconnected', data);
      } catch (error) {
        logError('Error handling user disconnection', error);
        socket.emit('error', { message: 'Failed to process disconnection' });
      }
    });
    
    // Handle heartbeat messages
    socket.on('heartbeat', (data: { userId: string, roomToken: string, timestamp: number }) => {
      // Just log occasionally to reduce noise
      if (Math.random() < 0.01) { // Reduced to 1% probability (was 10%)
        connectionLogger.log(`Heartbeat received`, { 
          userId: data.userId, 
          roomToken: data.roomToken,
          timeGap: Date.now() - data.timestamp
        }, true);
      }
    });
    
    // Handle disconnection
    socket.on('disconnect', async () => {
      try {
        if (currentRoomToken && currentUserId) {
          // Log the disconnect
          connectionLogger.log(`User socket disconnected`, { 
            userId: currentUserId, 
            roomToken: currentRoomToken,
            socketId: socket.id
          });
          
          // Clean up video streams
          videoManager.handleDisconnect(socket, currentRoomToken, currentUserId);
          
          // Get room
          const room = await storage.getRoom(currentRoomToken);
          if (!room) return;
          
          // Remove participant from room
          await storage.removeParticipant(room.id, currentUserId);
          
          // Remove client from room users
          const roomUsers = rooms.get(currentRoomToken);
          if (roomUsers) {
            roomUsers.delete(currentUserId);
            
            // If room is empty, remove room
            if (roomUsers.size === 0) {
              roomLogger.log(`Room is now empty, removing tracking`, { roomToken: currentRoomToken });
              rooms.delete(currentRoomToken);
            } else {
              // Get updated participants
              const updatedParticipants = await storage.getParticipantsByRoom(room.id);
              
              // Broadcast room update to all clients
              io.to(currentRoomToken).emit('roomUpdate', {
                participants: updatedParticipants.map(p => ({
                  userId: p.userId,
                  nickname: p.nickname,
                  position: p.position,
                  hasVideo: p.hasVideo
                }))
              });
              
              roomLogger.log(`Broadcast room update after disconnect`, { 
                roomToken: currentRoomToken, 
                remainingParticipants: updatedParticipants.length 
              });
            }
          }
        } else {
          // Just a connection that never joined a room
          socketLogger.log(`Disconnected socket that wasn't in a room`, { socketId: socket.id });
        }
      } catch (error) {
        logError('Error handling socket disconnect', error);
      }
    });
  });
  
  return httpServer;
}