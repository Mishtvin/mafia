import { Socket, Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";

// Types for video stream management
export interface VideoChunk {
  userId: string;
  timestamp: number;
  data: Uint8Array;
  frameId: number;
}

export interface StreamMetadata {
  userId: string;
  width: number;
  height: number;
  frameRate: number;
  codecParams?: any;
}

// Class to handle server-side video streaming
export class VideoStreamManager {
  private io: SocketIOServer;
  private activeStreams: Map<string, Map<string, StreamMetadata>> = new Map(); // roomToken -> Map<userId, metadata>
  
  constructor(io: SocketIOServer) {
    this.io = io;
  }
  
  // Register video stream handlers for a socket
  public registerHandlers(socket: Socket): void {
    // Handle when client starts a video stream
    socket.on('video:start', async (data: StreamMetadata & { roomToken: string }) => {
      const { roomToken, userId, width, height, frameRate, codecParams } = data;
      
      // Store metadata for the stream
      if (!this.activeStreams.has(roomToken)) {
        this.activeStreams.set(roomToken, new Map());
      }
      
      // Store the stream metadata
      const roomStreams = this.activeStreams.get(roomToken)!;
      roomStreams.set(userId, {
        userId,
        width,
        height,
        frameRate,
        codecParams
      });
      
      // Notify all clients in the room about the new stream
      socket.to(roomToken).emit('video:newStream', {
        userId,
        width,
        height,
        frameRate,
        codecParams
      });
      
      console.log(`User ${userId} started streaming video in room ${roomToken}`);
      
      // Update participant video status in storage
      try {
        const room = await storage.getRoom(roomToken);
        if (!room) return;
        
        const participant = await storage.getParticipant(room.id, userId);
        if (!participant) return;
        
        await storage.updateParticipantVideo(participant.id, true);
      } catch (error) {
        console.error('Error updating participant video status:', error);
      }
    });
    
    // Handle video stream chunks
    socket.on('video:chunk', (data: VideoChunk & { roomToken: string }) => {
      const { roomToken, userId, timestamp, data: videoData, frameId } = data;
      
      // Forward the chunk to all other clients in the room
      socket.to(roomToken).emit('video:chunk', {
        userId,
        timestamp,
        data: videoData,
        frameId
      });
    });
    
    // Handle when client stops streaming
    socket.on('video:stop', async (data: { roomToken: string, userId: string }) => {
      const { roomToken, userId } = data;
      
      // Remove the stream metadata
      const roomStreams = this.activeStreams.get(roomToken);
      if (roomStreams) {
        roomStreams.delete(userId);
        
        // If no more streams in the room, clean up
        if (roomStreams.size === 0) {
          this.activeStreams.delete(roomToken);
        }
      }
      
      // Notify all clients that the stream has stopped
      socket.to(roomToken).emit('video:streamEnded', { userId });
      
      console.log(`User ${userId} stopped streaming video in room ${roomToken}`);
      
      // Update participant video status in storage
      try {
        const room = await storage.getRoom(roomToken);
        if (!room) return;
        
        const participant = await storage.getParticipant(room.id, userId);
        if (!participant) return;
        
        await storage.updateParticipantVideo(participant.id, false);
      } catch (error) {
        console.error('Error updating participant video status:', error);
      }
    });
  }
  
  // Clean up streams when a user disconnects
  public handleDisconnect(socket: Socket, roomToken: string, userId: string): void {
    const roomStreams = this.activeStreams.get(roomToken);
    if (roomStreams) {
      if (roomStreams.has(userId)) {
        roomStreams.delete(userId);
        
        // Notify all clients that the stream has stopped
        socket.to(roomToken).emit('video:streamEnded', { userId });
        
        console.log(`User ${userId} stream ended due to disconnect from room ${roomToken}`);
      }
      
      // If no more streams in the room, clean up
      if (roomStreams.size === 0) {
        this.activeStreams.delete(roomToken);
      }
    }
  }
  
  // Get active streams in a room
  public getActiveStreams(roomToken: string): StreamMetadata[] {
    const roomStreams = this.activeStreams.get(roomToken);
    if (!roomStreams) return [];
    
    return Array.from(roomStreams.values());
  }
}