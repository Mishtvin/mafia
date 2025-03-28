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
import { VideoStreamManager } from "./videoHandler";
import { connectionStatusSchema } from "@shared/registerEvents";

// For legacy compatibility - will be less used in server streaming model
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
  
  // Create video stream manager
  const videoManager = new VideoStreamManager(io);
  
  // Map to track socket connections by room and user ID
  const rooms = new Map<string, Map<string, string>>(); // roomToken -> Map<userId, socketId>
  
  // API Route: Create a new room
  app.post('/api/rooms', async (req, res) => {
    try {
      const room = await storage.createRoom();
      res.status(201).json({ 
        token: room.token,
        createdAt: room.createdAt
      });
    } catch (error) {
      console.error('Error creating room:', error);
      res.status(500).json({ message: 'Error creating room' });
    }
  });
  
  // API Route: Get room info
  app.get('/api/rooms/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const room = await storage.getRoom(token);
      
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      
      const participants = await storage.getParticipantsByRoom(room.id);
      
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
      console.error('Error getting room:', error);
      res.status(500).json({ message: 'Error getting room' });
    }
  });
  
  // Socket.IO connection handler
  io.on('connection', (socket: Socket) => {
    console.log('Socket.IO client connected:', socket.id);
    
    // Send immediate welcome message to establish connection as stable
    socket.emit('welcome', { message: 'Connected to Socket.IO server' });
    
    // Register video stream handlers
    videoManager.registerHandlers(socket);
    
    let currentRoomToken: string | null = null;
    let currentUserId: string | null = null;
    
    // Handle join room event
    socket.on('joinRoom', async (data) => {
      try {
        if (!joinRoomMessageSchema.safeParse(data).success) {
          socket.emit('error', { message: 'Invalid join room data' });
          return;
        }
        
        const { roomToken, nickname, userId } = data;
        currentRoomToken = roomToken;
        currentUserId = userId;
        
        console.log(`User ${userId} (${nickname}) is joining room ${roomToken}`);
        
        // Socket.IO join room
        socket.join(roomToken);
        
        // Store user and room info
        if (!rooms.has(roomToken)) {
          rooms.set(roomToken, new Map());
          console.log(`Created new room tracking for ${roomToken}`);
        }
        
        const roomUsers = rooms.get(roomToken)!;
        roomUsers.set(userId, socket.id);
        console.log(`Room ${roomToken} now has ${roomUsers.size} users tracked`);
        
        // Get room
        const room = await storage.getRoom(roomToken);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
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
          return;
        }
        
        // Check if participant already exists (rejoining)
        const existingParticipant = await storage.getParticipant(room.id, userId);
        
        if (existingParticipant) {
          console.log(`User ${userId} is rejoining room ${roomToken}`);
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
          console.log(`Added new participant ${userId} to room ${roomToken} at position ${position}`);
        }
        
        // Get updated participants
        const updatedParticipants = await storage.getParticipantsByRoom(room.id);
        console.log(`Room ${roomToken} has ${updatedParticipants.length} participants`);
        
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
        
        console.log(`Room update sent for room ${roomToken} with ${updatedParticipants.length} participants`);
      } catch (error) {
        console.error('Error joining room:', error);
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
        
        console.log(`User ${userId} left room ${roomToken}`);
      } catch (error) {
        console.error('Error leaving room:', error);
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
        
        console.log(`User ${userId} updated video status to ${hasVideo}`);
      } catch (error) {
        console.error('Error updating video status:', error);
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
        
        console.log(`Position update in room ${roomToken}`);
      } catch (error) {
        console.error('Error updating positions:', error);
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
        
        console.log(`WebRTC signaling: ${sender} -> ${receiver}, action: ${data.action}`);
      } catch (error) {
        console.error('Error processing WebRTC signaling:', error);
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
        
        console.log(`User connection event: ${userId} connected=${connected} in room ${roomToken}`);
        
        // Broadcast to room
        socket.to(roomToken).emit('userConnected', data);
      } catch (error) {
        console.error('Error handling user connection:', error);
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
        
        console.log(`User ${userId} manually disconnected from room ${roomToken}`);
        
        // Broadcast to room
        socket.to(roomToken).emit('userDisconnected', data);
      } catch (error) {
        console.error('Error handling user disconnection:', error);
      }
    });
    
    // Handle heartbeat messages
    socket.on('heartbeat', (data: { userId: string, roomToken: string, timestamp: number }) => {
      // Just log occasionally to reduce noise
      if (Math.random() < 0.1) {
        console.log(`Heartbeat from ${data.userId} in room ${data.roomToken}`);
      }
    });
    
    // Handle disconnection
    socket.on('disconnect', async () => {
      try {
        if (currentRoomToken && currentUserId) {
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
            }
          }
          
          console.log(`User ${currentUserId} disconnected from room ${currentRoomToken}`);
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    });
  });
  
  return httpServer;
}