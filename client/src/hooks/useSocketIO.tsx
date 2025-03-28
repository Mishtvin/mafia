import { useState, useEffect, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useToast } from "./use-toast";

export function useSocketIO(roomToken: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);
  const socketRef = useRef<Socket | null>(null);
  const { toast } = useToast();
  
  // Initialize Socket.IO connection
  useEffect(() => {
    console.log("Initializing Socket.IO connection...");
    
    // Connect to the Socket.IO server
    const socket = io({
      // Socket.IO options for reliability
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 10,
      timeout: 20000,
      autoConnect: true,
      forceNew: true
    });
    
    // Store socket reference
    socketRef.current = socket;
    
    // Listen for connection events
    socket.on("connect", () => {
      console.log("Socket.IO connected with ID:", socket.id);
      setIsConnected(true);
      
      toast({
        title: "Connection established",
        description: "Connected to server",
        variant: "default",
      });
    });
    
    // Listen for connection error
    socket.on("connect_error", (err) => {
      console.log("Socket.IO connection error:", err.message);
      // The disconnection handler will manage reconnection
    });
    
    // Listen for disconnection
    socket.on("disconnect", (reason) => {
      console.log("Socket.IO disconnected:", reason);
      setIsConnected(false);
      
      toast({
        title: "Connection lost",
        description: "Reconnecting...",
        variant: "destructive",
      });
    });
    
    // Listen for reconnection attempts
    socket.io.on("reconnect_attempt", (attemptNumber) => {
      console.log(`Socket.IO reconnection attempt ${attemptNumber}...`);
    });
    
    // Listen for successful reconnection
    socket.io.on("reconnect", () => {
      console.log("Socket.IO reconnected successfully");
      
      toast({
        title: "Connection restored",
        description: "Reconnected to server",
        variant: "default",
      });
    });
    
    // Listen for reconnection failure
    socket.io.on("reconnect_failed", () => {
      console.log("Socket.IO reconnection failed after all attempts");
      
      toast({
        title: "Connection failed",
        description: "Please refresh the page",
        variant: "destructive",
      });
    });
    
    // Listen for welcome message
    socket.on("welcome", (data) => {
      console.log("Received welcome message:", data);
    });
    
    // Listen for error messages
    socket.on("error", (data) => {
      console.error("Received error from server:", data);
      
      toast({
        title: "Server Error",
        description: data.message || "Unknown error occurred",
        variant: "destructive",
      });
    });
    
    // Listen for room updates
    socket.on("roomUpdate", (data) => {
      console.log("Received room update:", data);
      setLastMessage(data);
      
      // Dispatch a custom event for other hooks to listen to
      const customEvent = new CustomEvent("roomUpdate", {
        detail: data
      });
      window.dispatchEvent(customEvent);
    });
    
    // Listen for WebRTC signaling
    socket.on("webrtc", (data) => {
      console.log("Received WebRTC signaling:", data.action);
      
      // Dispatch a custom event for WebRTC handling
      const customEvent = new CustomEvent("webrtc", {
        detail: data
      });
      window.dispatchEvent(customEvent);
    });
    
    // Clean up Socket.IO connection
    return () => {
      console.log("Cleaning up Socket.IO connection");
      socket.disconnect();
    };
  }, [toast, roomToken]);
  
  // Send message through Socket.IO
  const sendMessage = useCallback((eventName: string, message: any) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit(eventName, message);
      return true;
    }
    return false;
  }, [isConnected]);
  
  // Join a room
  const joinRoom = useCallback((nickname: string, userId: string) => {
    return sendMessage('joinRoom', {
      type: 'joinRoom',
      roomToken,
      nickname,
      userId
    });
  }, [roomToken, sendMessage]);
  
  // Leave a room
  const leaveRoom = useCallback((userId: string) => {
    return sendMessage('leaveRoom', {
      type: 'leaveRoom',
      roomToken,
      userId
    });
  }, [roomToken, sendMessage]);
  
  // Update video status
  const updateVideoStatus = useCallback((userId: string, hasVideo: boolean) => {
    return sendMessage('videoStatus', {
      type: 'videoStatus',
      roomToken,
      userId,
      hasVideo
    });
  }, [roomToken, sendMessage]);
  
  // Update positions
  const updatePositions = useCallback((positions: { userId: string, position: number }[]) => {
    return sendMessage('updatePositions', {
      type: 'positionUpdate',
      roomToken,
      positions
    });
  }, [roomToken, sendMessage]);
  
  // Send WebRTC signaling
  const sendWebRTCSignal = useCallback((data: any) => {
    return sendMessage('webrtc', {
      ...data,
      roomToken
    });
  }, [roomToken, sendMessage]);
  
  return {
    isConnected,
    lastMessage,
    joinRoom,
    leaveRoom,
    updateVideoStatus,
    updatePositions,
    sendWebRTCSignal,
    socket: socketRef.current, // Expose the socket instance for direct communication
    sendMessage   // Expose the sendMessage function for custom events
  };
}