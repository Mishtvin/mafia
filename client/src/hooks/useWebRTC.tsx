import { useState, useEffect, useCallback, useRef } from "react";
import { useWebSocket } from "./useWebSocket";
import Peer from "simple-peer-light";

// Define types for WebRTC signaling
type SignalData = {
  type: string;
  [key: string]: any;
};

type WebRTCMessage = {
  type: 'webrtc';
  action: 'offer' | 'answer' | 'ice-candidate';
  sender: string;
  receiver: string;
  roomToken: string;
  payload: SignalData;
};

// Use any for peer connections to avoid typing issues
type PeerConnection = any;

export function useWebRTC(roomToken: string, userId: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hasVideo, setHasVideo] = useState(true);
  const [peerStreams, setPeerStreams] = useState<Record<string, MediaStream>>({});
  const [isInitialized, setIsInitialized] = useState(false);
  
  const peersRef = useRef<Record<string, PeerConnection>>({});
  const { sendMessage } = useWebSocket(roomToken);
  
  // Initialize WebRTC
  useEffect(() => {
    async function initializeWebRTC() {
      try {
        // Get user media with video only (no audio)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        
        setLocalStream(stream);
        setIsInitialized(true);
      } catch (error) {
        console.error("Error accessing webcam:", error);
        setHasVideo(false);
        // Create empty stream so peers can still connect
        setLocalStream(new MediaStream());
        setIsInitialized(true);
      }
    }
    
    if (!isInitialized) {
      initializeWebRTC();
    }
    
    // Cleanup function
    return () => {
      // Close all peer connections
      Object.values(peersRef.current).forEach(peer => {
        peer.destroy();
      });
      
      // Stop local stream tracks
      if (localStream) {
        localStream.getTracks().forEach(track => {
          track.stop();
        });
      }
    };
  }, [isInitialized, localStream]);
  
  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      
      // If we have video tracks
      if (videoTracks.length > 0) {
        const newState = !hasVideo;
        videoTracks.forEach(track => {
          track.enabled = newState;
        });
        setHasVideo(newState);
      } else if (!hasVideo) {
        // If we don't have video tracks but want to enable video
        // Request camera access again
        navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        }).then(stream => {
          // Replace the existing local stream
          setLocalStream(stream);
          setHasVideo(true);
          
          // Update all peer connections with the new stream
          Object.values(peersRef.current).forEach(peer => {
            const videoTrack = stream.getVideoTracks()[0];
            const sender = (peer as any)._senders?.find((s: any) => s?.track?.kind === 'video');
            if (sender && videoTrack) {
              sender.replaceTrack(videoTrack);
            }
          });
        }).catch(error => {
          console.error("Error accessing webcam:", error);
        });
      }
    }
  }, [hasVideo, localStream]);
  
  // Create a peer connection
  const createPeer = useCallback((targetUserId: string, initiator: boolean) => {
    if (!localStream) return null;

    try {
      const peer = new Peer({
        initiator,
        trickle: false,
        stream: localStream
      });
      
      // Handle signaling
      peer.on('signal', (signal: SignalData) => {
        sendMessage({
          type: 'webrtc',
          action: initiator ? 'offer' : 'answer',
          sender: userId,
          receiver: targetUserId,
          roomToken,
          payload: signal
        } as WebRTCMessage);
      });
      
      // Handle incoming stream
      peer.on('stream', (stream: MediaStream) => {
        setPeerStreams(prevStreams => ({
          ...prevStreams,
          [targetUserId]: stream
        }));
      });
      
      // Handle peer closure
      peer.on('close', () => {
        console.log(`Peer connection with ${targetUserId} closed`);
        handleParticipantLeft(targetUserId);
      });
      
      // Handle peer errors
      peer.on('error', (err: Error) => {
        console.error(`Peer connection error with ${targetUserId}:`, err);
        handleParticipantLeft(targetUserId);
      });
      
      return peer;
    } catch (error) {
      console.error("Error creating peer:", error);
      return null;
    }
  }, [localStream, roomToken, sendMessage, userId]);
  
  // Connect to multiple peers
  const connectToPeers = useCallback((peerIds: string[]) => {
    if (!localStream || !isInitialized) return;
    
    peerIds.forEach(peerId => {
      if (!peersRef.current[peerId]) {
        const peer = createPeer(peerId, true);
        if (peer) {
          peersRef.current[peerId] = peer;
        }
      }
    });
  }, [createPeer, localStream, isInitialized]);
  
  // Handle receiving a WebRTC signal
  const handleSignal = useCallback((data: WebRTCMessage) => {
    const { sender, action, payload } = data;
    
    if (action === 'offer') {
      let peer = peersRef.current[sender];
      
      if (!peer && localStream) {
        peer = createPeer(sender, false);
        if (peer) {
          peersRef.current[sender] = peer;
        }
      }
      
      if (peer) {
        peer.signal(payload);
      }
    } else if (action === 'answer') {
      const peer = peersRef.current[sender];
      if (peer) {
        peer.signal(payload);
      }
    } else if (action === 'ice-candidate') {
      const peer = peersRef.current[sender];
      if (peer) {
        peer.signal(payload);
      }
    }
  }, [createPeer, localStream]);
  
  // Handle new participant joining
  const handleNewParticipant = useCallback((peerId: string) => {
    if (peerId === userId || peersRef.current[peerId]) return;
    
    const peer = createPeer(peerId, true);
    if (peer) {
      peersRef.current[peerId] = peer;
    }
  }, [createPeer, userId]);
  
  // Handle participant leaving
  const handleParticipantLeft = useCallback((peerId: string) => {
    // Destroy peer connection
    if (peersRef.current[peerId]) {
      peersRef.current[peerId].destroy();
      delete peersRef.current[peerId];
    }
    
    // Remove stream
    setPeerStreams(prevStreams => {
      const newStreams = { ...prevStreams };
      delete newStreams[peerId];
      return newStreams;
    });
  }, []);
  
  // Process WebRTC signaling messages
  useEffect(() => {
    function onWebSocketMessage(event: MessageEvent) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'webrtc' && data.receiver === userId) {
          handleSignal(data as WebRTCMessage);
        }
      } catch (error) {
        console.error('Error processing WebRTC message:', error);
      }
    }
    
    // Setup WebSocket message handler
    window.addEventListener('message', onWebSocketMessage);
    
    return () => {
      window.removeEventListener('message', onWebSocketMessage);
    };
  }, [handleSignal, userId]);
  
  return {
    localStream,
    peerStreams,
    hasVideo,
    toggleVideo,
    connectToPeers,
    handleNewParticipant,
    handleParticipantLeft
  };
}
