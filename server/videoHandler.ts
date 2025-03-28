import { Socket, Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import { videoLogger } from "./logger";

// Types for video stream management
export interface VideoChunk {
  userId: string;
  timestamp: number;
  data: Uint8Array;
  frameId: number;
  encoded: boolean;
}

export interface StreamMetadata {
  userId: string;
  width: number;
  height: number;
  frameRate: number;
  codecParams?: any;
  active?: boolean;
  lastActive?: number;
}

// Enhanced class to handle server-side video streaming
export class VideoStreamManager {
  private io: SocketIOServer;
  private activeStreams: Map<string, Map<string, StreamMetadata>> = new Map(); // roomToken -> Map<userId, metadata>
  private frameBuffers: Map<string, Map<string, VideoChunk[]>> = new Map(); // roomToken -> userId -> chunks[]
  private processingJobs: Map<string, NodeJS.Timeout> = new Map(); // userId -> timeout
  
  // Constants
  private MAX_BUFFER_SIZE = 10; // Maximum number of frames to buffer per user
  private PROCESSING_INTERVAL = 200; // Process frames every 200ms
  private STREAM_TIMEOUT = 10000; // Consider a stream inactive after 10 seconds of no frames
  
  constructor(io: SocketIOServer) {
    this.io = io;
    
    // Clean up inactive streams periodically
    setInterval(() => this.cleanupInactiveStreams(), 5000);
  }
  
  // Register video stream handlers for a socket
  public registerHandlers(socket: Socket): void {
    // Handle when client starts a video stream
    socket.on('video:start', async (data: StreamMetadata & { roomToken: string }) => {
      const { roomToken, userId, width, height, frameRate, codecParams } = data;
      
      videoLogger.log(`User starting stream`, { 
        userId, 
        roomToken, 
        resolution: `${width}x${height}`, 
        frameRate 
      });
      
      // Store metadata for the stream
      if (!this.activeStreams.has(roomToken)) {
        this.activeStreams.set(roomToken, new Map());
      }
      
      // Initialize frame buffer for this user
      if (!this.frameBuffers.has(roomToken)) {
        this.frameBuffers.set(roomToken, new Map());
      }
      
      const roomBuffers = this.frameBuffers.get(roomToken)!;
      if (!roomBuffers.has(userId)) {
        roomBuffers.set(userId, []);
      }
      
      // Store the stream metadata
      const roomStreams = this.activeStreams.get(roomToken)!;
      roomStreams.set(userId, {
        userId,
        width: width || 320,
        height: height || 240,
        frameRate: frameRate || 15,
        codecParams,
        active: true,
        lastActive: Date.now()
      });
      
      // Notify all clients in the room about the new stream
      socket.to(roomToken).emit('video:newStream', {
        userId,
        width: width || 320,
        height: height || 240,
        frameRate: frameRate || 15,
        codecParams
      });
      
      videoLogger.log(`Stream started and registered`, { userId, roomToken });
      
      // Update participant video status in storage
      try {
        const room = await storage.getRoom(roomToken);
        if (!room) return;
        
        const participant = await storage.getParticipant(room.id, userId);
        if (!participant) return;
        
        await storage.updateParticipantVideo(participant.id, true);
      } catch (error) {
        videoLogger.log('Error updating participant video status', { 
          userId, 
          roomToken, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });
    
    // Handle video stream chunks from clients
    socket.on('video:chunk', (data: VideoChunk & { roomToken: string }) => {
      const { roomToken, userId, timestamp, data: videoData, frameId, encoded = false } = data;
      
      // Update last active timestamp
      const roomStreams = this.activeStreams.get(roomToken);
      if (roomStreams && roomStreams.has(userId)) {
        const streamInfo = roomStreams.get(userId)!;
        streamInfo.lastActive = Date.now();
        streamInfo.active = true;
        roomStreams.set(userId, streamInfo);
      }
      
      // Add the chunk to the buffer for this user
      const roomBuffers = this.frameBuffers.get(roomToken);
      if (!roomBuffers) return;
      
      const userBuffer = roomBuffers.get(userId);
      if (!userBuffer) return;
      
      // Add new chunk to the buffer
      userBuffer.push({
        userId,
        timestamp,
        data: videoData,
        frameId,
        encoded
      });
      
      // Limit buffer size by removing oldest chunks if necessary
      while (userBuffer.length > this.MAX_BUFFER_SIZE) {
        userBuffer.shift();
      }
      
      // Schedule frame processing if not already scheduled
      const processingKey = `${roomToken}-${userId}`;
      if (!this.processingJobs.has(processingKey)) {
        const job = setTimeout(() => {
          this.processFrames(roomToken, userId);
          this.processingJobs.delete(processingKey);
        }, this.PROCESSING_INTERVAL);
        
        this.processingJobs.set(processingKey, job);
      }
    });
    
    // Handle image frame from clients (for devices without camera)
    socket.on('video:image', (data: { roomToken: string, userId: string, image: string }) => {
      const { roomToken, userId, image } = data;
      
      // Update last active timestamp
      const roomStreams = this.activeStreams.get(roomToken);
      if (roomStreams && roomStreams.has(userId)) {
        const streamInfo = roomStreams.get(userId)!;
        streamInfo.lastActive = Date.now();
        streamInfo.active = true;
        roomStreams.set(userId, streamInfo);
      }
      
      // Forward the image to all other clients
      socket.to(roomToken).emit('video:image', {
        userId,
        image,
        timestamp: Date.now(),
      });
    });
    
    // Handle when client stops streaming
    socket.on('video:stop', async (data: { roomToken: string, userId: string }) => {
      const { roomToken, userId } = data;
      
      // Remove the stream metadata
      const roomStreams = this.activeStreams.get(roomToken);
      if (roomStreams) {
        if (roomStreams.has(userId)) {
          const streamInfo = roomStreams.get(userId)!;
          streamInfo.active = false;
          roomStreams.set(userId, streamInfo);
        }
      }
      
      // Notify all clients that the stream has stopped
      socket.to(roomToken).emit('video:streamEnded', { userId });
      
      videoLogger.log(`Stream stopped`, { userId, roomToken });
      
      // Update participant video status in storage
      try {
        const room = await storage.getRoom(roomToken);
        if (!room) return;
        
        const participant = await storage.getParticipant(room.id, userId);
        if (!participant) return;
        
        await storage.updateParticipantVideo(participant.id, false);
      } catch (error) {
        videoLogger.log('Error updating participant video status', { 
          userId, 
          roomToken, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });
  }
  
  // Process frames from the buffer
  private processFrames(roomToken: string, userId: string): void {
    const roomBuffers = this.frameBuffers.get(roomToken);
    if (!roomBuffers) return;
    
    const userBuffer = roomBuffers.get(userId);
    if (!userBuffer || userBuffer.length === 0) return;
    
    // For server-side processing, we could apply transformations, encoding
    // or other processing here. For now, we'll just batch and forward frames
    
    // Sort frames by frameId
    userBuffer.sort((a, b) => a.frameId - b.frameId);
    
    // Get the latest frame (simpler than processing all)
    const latestFrame = userBuffer[userBuffer.length - 1];
    
    // Clear the buffer
    userBuffer.length = 0;
    
    // Send the processed frame to all clients in the room
    this.io.to(roomToken).emit('video:processedFrame', {
      userId,
      timestamp: latestFrame.timestamp,
      data: latestFrame.data,
      frameId: latestFrame.frameId,
      processed: true,
      serverTimestamp: Date.now()
    });
  }
  
  // Clean up inactive streams
  private cleanupInactiveStreams(): void {
    const now = Date.now();
    
    this.activeStreams.forEach((roomStreams, roomToken) => {
      let hasInactive = false;
      
      roomStreams.forEach((streamInfo, userId) => {
        if (streamInfo.lastActive && now - streamInfo.lastActive > this.STREAM_TIMEOUT) {
          videoLogger.log(`Stream timed out due to inactivity`, { 
            userId, 
            roomToken, 
            inactiveTime: now - streamInfo.lastActive 
          });
          streamInfo.active = false;
          roomStreams.set(userId, streamInfo);
          hasInactive = true;
          
          // Notify clients that this stream has ended
          this.io.to(roomToken).emit('video:streamEnded', { userId });
        }
      });
      
      // Remove inactive streams from metadata
      if (hasInactive) {
        roomStreams.forEach((streamInfo, userId) => {
          if (!streamInfo.active) {
            // Mark as inactive but keep the metadata
            // This helps if the user reactivates their stream shortly after
          }
        });
      }
      
      // If room has no active streams, we might clean it up later
      let hasActive = false;
      roomStreams.forEach(streamInfo => {
        if (streamInfo.active) hasActive = true;
      });
      
      // If no active streams, we might consider cleaning up this room
      // But keep it for now to handle users who might restart their streams
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
        
        videoLogger.log(`Stream ended due to disconnect`, { userId, roomToken });
      }
      
      // If no more streams in the room, clean up
      if (roomStreams.size === 0) {
        this.activeStreams.delete(roomToken);
        
        // Clean up frame buffers for this room
        if (this.frameBuffers.has(roomToken)) {
          this.frameBuffers.delete(roomToken);
        }
      }
    }
    
    // Clean up any processing jobs for this user
    const processingKey = `${roomToken}-${userId}`;
    if (this.processingJobs.has(processingKey)) {
      clearTimeout(this.processingJobs.get(processingKey));
      this.processingJobs.delete(processingKey);
    }
  }
  
  // Get active streams in a room
  public getActiveStreams(roomToken: string): StreamMetadata[] {
    const roomStreams = this.activeStreams.get(roomToken);
    if (!roomStreams) return [];
    
    return Array.from(roomStreams.values()).filter(stream => stream.active);
  }
}