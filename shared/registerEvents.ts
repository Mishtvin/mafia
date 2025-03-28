/**
 * This file contains functions to register user events and ensure proper synchronization
 * across users in a room. It helps track when users join and leave, and ensures that
 * all participants have a consistent view of the room.
 */

import { Socket } from 'socket.io-client';
import { z } from 'zod';

/**
 * Event schema for connection status updates
 */
export const connectionStatusSchema = z.object({
  userId: z.string(),
  connected: z.boolean(),
  nickname: z.string().optional(),
  hasVideo: z.boolean().optional(),
  timestamp: z.number()
});

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/**
 * Register connection status event handlers with a socket
 * @param socket The socket.io client socket
 * @param userId Current user ID
 * @param roomToken Room token
 * @param onUserStatusChange Callback for user status changes
 */
export function registerConnectionEvents(
  socket: Socket,
  userId: string,
  roomToken: string,
  onUserStatusChange?: (status: ConnectionStatus) => void
) {
  console.log(`[REGISTER] Setting up connection status events for room ${roomToken}`);
  
  // Broadcast when a user connects
  socket.emit('userConnected', {
    userId,
    roomToken,
    connected: true,
    timestamp: Date.now()
  });
  
  // Listen for user connected events
  socket.on('userConnected', (data: ConnectionStatus) => {
    console.log(`[REGISTER] User connected event:`, data);
    
    // Call the callback if provided
    if (onUserStatusChange) {
      onUserStatusChange(data);
    }
    
    // If another user connected, send our status to help them sync
    if (data.userId !== userId) {
      socket.emit('userConnected', {
        userId,
        roomToken,
        connected: true,
        timestamp: Date.now()
      });
    }
  });
  
  // Listen for user disconnected events
  socket.on('userDisconnected', (data: ConnectionStatus) => {
    console.log(`[REGISTER] User disconnected event:`, data);
    
    // Call the callback if provided
    if (onUserStatusChange) {
      onUserStatusChange({
        ...data,
        connected: false
      });
    }
  });
  
  // Send disconnect when leaving
  const handleBeforeUnload = () => {
    socket.emit('userDisconnected', {
      userId,
      roomToken,
      connected: false,
      timestamp: Date.now()
    });
  };
  
  // Register window event handlers
  window.addEventListener('beforeunload', handleBeforeUnload);
  
  // Return cleanup function
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    
    // Send disconnect event
    socket.emit('userDisconnected', {
      userId,
      roomToken,
      connected: false,
      timestamp: Date.now()
    });
    
    // Remove socket listeners
    socket.off('userConnected');
    socket.off('userDisconnected');
  };
}

/**
 * Register video streaming events with a socket
 * @param socket The socket.io client socket
 * @param onVideoStart Callback for when a user starts streaming
 * @param onVideoStop Callback for when a user stops streaming
 */
export function registerVideoEvents(
  socket: Socket,
  onVideoStart?: (userId: string) => void,
  onVideoStop?: (userId: string) => void
) {
  console.log('[REGISTER] Setting up video streaming events');
  
  // Listen for video start events
  socket.on('video:start', (data: { userId: string }) => {
    console.log(`[REGISTER] User ${data.userId} started streaming`);
    
    if (onVideoStart) {
      onVideoStart(data.userId);
    }
  });
  
  // Listen for video stop events
  socket.on('video:stop', (data: { userId: string }) => {
    console.log(`[REGISTER] User ${data.userId} stopped streaming`);
    
    if (onVideoStop) {
      onVideoStop(data.userId);
    }
  });
  
  // Return cleanup function
  return () => {
    socket.off('video:start');
    socket.off('video:stop');
  };
}

/**
 * Register a heartbeat to keep connections alive
 * @param socket The socket.io client socket
 * @param userId Current user ID
 * @param roomToken Room token
 */
export function registerHeartbeat(
  socket: Socket,
  userId: string,
  roomToken: string
) {
  console.log(`[REGISTER] Setting up heartbeat for room ${roomToken}`);
  
  // Set up a heartbeat interval to help detect disconnects
  const heartbeatInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit('heartbeat', {
        userId,
        roomToken,
        timestamp: Date.now()
      });
    }
  }, 30000); // Every 30 seconds
  
  // Return cleanup function
  return () => {
    clearInterval(heartbeatInterval);
  };
}