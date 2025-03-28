import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "./use-toast";

// Constants
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL = 15000; // 15 seconds

export function useWebSocket(roomToken: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const websocket = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const { toast } = useToast();
  
  // Function to create a WebSocket connection
  const createWebSocketConnection = useCallback(() => {
    // Clean up any existing connection
    if (websocket.current) {
      websocket.current.close();
    }
    
    // Clear any pending reconnect timeouts
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Create WebSocket connection
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Use the current host but ensure we're connecting to the server's WebSocket endpoint
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`Connecting to WebSocket at ${wsUrl}...`);
    const ws = new WebSocket(wsUrl);
    
    // Add an explicit timeout to close the connection if it doesn't open within 5 seconds
    const connectionTimeoutId = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.log("WebSocket connection timeout, closing connection");
        ws.close();
      }
    }, 5000);
    
    // Connection opened
    ws.addEventListener("open", () => {
      // Clear the connection timeout
      clearTimeout(connectionTimeoutId);
      
      console.log("WebSocket connection established");
      setIsConnected(true);
      setReconnectAttempts(0); // Reset reconnect attempts on successful connection
      
      // If we had shown a disconnection toast, show a reconnection toast
      if (reconnectAttempts > 0) {
        toast({
          title: "Connection restored",
          description: "You are now connected to the server",
          variant: "default",
        });
      }
    });
    
    // Connection closed
    ws.addEventListener("close", (event) => {
      // Clear the connection timeout if it's still active
      clearTimeout(connectionTimeoutId);
      
      console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
      setIsConnected(false);
      
      // Show toast if connection was previously established
      if (isConnected) {
        toast({
          title: "Connection lost",
          description: "Reconnecting...",
          variant: "destructive",
        });
      }
      
      // Handle reconnection with exponential backoff
      // Use the constant we defined at the top of the file
      const maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
      if (reconnectAttempts < maxReconnectAttempts) {
        const baseDelay = 1000; // 1 second
        const delay = Math.min(
          baseDelay * Math.pow(1.5, reconnectAttempts), 
          10000 // maximum 10 seconds
        );
        
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
        
        setReconnectAttempts(prev => prev + 1);
        reconnectTimeoutRef.current = window.setTimeout(() => {
          createWebSocketConnection();
        }, delay);
      } else {
        console.error('Maximum reconnection attempts reached');
        toast({
          title: "Connection failed",
          description: "Please refresh the page",
          variant: "destructive",
        });
      }
    });
    
    // Connection error
    ws.addEventListener("error", (error) => {
      console.error("WebSocket error:", error);
      // Don't set isConnected to false here - let the close handler deal with reconnection
      // The error event is always followed by a close event
    });
    
    // Listen for messages
    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle welcome message
        if (data.type === 'welcome') {
          console.log("Received welcome message from server - connection stable");
        }
        
        // Handle pong response
        else if (data.type === 'pong') {
          console.log("Received pong from server - connection is alive");
        }
        
        setLastMessage(event.data);
        
        // Also dispatch a custom event for other hooks to listen for
        const customEvent = new MessageEvent("message", {
          data: event.data,
        });
        window.dispatchEvent(customEvent);
      } catch (e) {
        console.error("Failed to parse incoming WebSocket message:", e);
      }
    });
    
    // Store WebSocket reference
    websocket.current = ws;
    
    return ws;
  }, [isConnected, reconnectAttempts, toast]);
  
  // Initialize WebSocket connection
  useEffect(() => {
    const ws = createWebSocketConnection();
    
    // Implement client-side ping mechanism
    // This is a safeguard in addition to server pings to keep connection alive
    const pingIntervalId = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Send a ping message to server
        ws.send(JSON.stringify({ type: 'ping' }));
        console.log("Sent client ping to server");
      }
    }, PING_INTERVAL);
    
    // Clean up WebSocket connection and any pending timeouts
    return () => {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      
      clearInterval(pingIntervalId);
      
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close();
      }
    };
  }, [createWebSocketConnection, roomToken]); // Note: roomToken is included for potential future use
  
  // Send message through WebSocket with retry capability
  const sendMessage = useCallback((message: any) => {
    // If the connection is open, send immediately
    if (websocket.current?.readyState === WebSocket.OPEN) {
      websocket.current.send(JSON.stringify(message));
      return true;
    }
    
    // If the connection is being established, wait and retry
    if (websocket.current?.readyState === WebSocket.CONNECTING) {
      // Retry after a short delay
      setTimeout(() => {
        if (websocket.current?.readyState === WebSocket.OPEN) {
          websocket.current.send(JSON.stringify(message));
        }
      }, 500);
      return true;
    }
    
    // If the connection is closed or closing, return false
    return false;
  }, []);
  
  return {
    isConnected,
    sendMessage,
    lastMessage,
    reconnect: createWebSocketConnection,
  };
}
