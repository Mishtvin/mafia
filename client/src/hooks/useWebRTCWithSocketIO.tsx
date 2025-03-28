import { useEffect, useRef, useState, useCallback } from 'react';
import SimplePeer from 'simple-peer-light';
import { useSocketIO } from './useSocketIO';

type ParticipantWithStream = {
  userId: string;
  nickname: string;
  position: number;
  hasVideo: boolean;
  stream?: MediaStream;
};

export function useWebRTCWithSocketIO(roomToken: string, userId: string) {
  const [participants, setParticipants] = useState<ParticipantWithStream[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const peersRef = useRef<Map<string, SimplePeer.Instance>>(new Map());
  
  // Use Socket.IO hook
  const { isConnected, sendWebRTCSignal, updateVideoStatus } = useSocketIO(roomToken);
  
  // Get and set available video devices
  useEffect(() => {
    async function initCamera() {
      if (!isConnected || localStream) return;
      
      try {
        console.log('[CAMERA] Getting initial camera stream');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        setLocalStream(stream);
        
        // Enumerate devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');
        setVideoDevices(videoInputs);
        
        if (videoInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch (err) {
        console.error('[CAMERA] Error initializing camera:', err);
      }
    }
    
    initCamera();
  }, [isConnected, localStream, selectedDeviceId]);
  
  // Create peer connection
  const createPeer = useCallback((peerId: string, initiator: boolean) => {
    if (!localStream) {
      console.error('[PEER] Cannot create peer: local stream not available');
      return null;
    }
    
    const peer = new SimplePeer({
      initiator,
      stream: localStream,
      trickle: true
    }) as SimplePeer.Instance;
    
    peer.on('signal', signal => {
      sendWebRTCSignal({
        type: 'webrtc',
        action: initiator ? 'offer' : 'answer',
        sender: userId,
        receiver: peerId,
        payload: signal
      });
    });
    
    peer.on('stream', stream => {
      setParticipants(prev => 
        prev.map(p => p.userId === peerId ? { ...p, stream } : p)
      );
    });
    
    peer.on('error', err => {
      console.error(`[PEER] Error with peer ${peerId}:`, err);
    });
    
    peersRef.current.set(peerId, peer);
    return peer;
  }, [localStream, userId, sendWebRTCSignal]);
  
  // Handle WebRTC signal
  const handleSignal = useCallback((data: any) => {
    if (data.receiver !== userId) return;
    
    const { sender, action, payload } = data;
    const peer = peersRef.current.get(sender);
    
    if (!peer) {
      if (action === 'offer') {
        const newPeer = createPeer(sender, false);
        newPeer?.signal(payload);
      }
    } else {
      peer.signal(payload);
    }
  }, [userId, createPeer]);
  
  // Handle room update
  const handleRoomUpdate = useCallback((participantList: any[]) => {
    // Handle new participants
    participantList
      .filter(p => p.userId !== userId && !peersRef.current.has(p.userId))
      .forEach(p => createPeer(p.userId, true));
    
    // Handle departed participants
    peersRef.current.forEach((peer, peerId) => {
      if (!participantList.some(p => p.userId === peerId)) {
        peer.destroy();
        peersRef.current.delete(peerId);
      }
    });
    
    // Update participant list preserving streams
    setParticipants(prev => {
      return participantList.map(p => {
        const existing = prev.find(ep => ep.userId === p.userId);
        return { ...p, stream: existing?.stream };
      });
    });
  }, [userId, createPeer]);
  
  // Set up WebRTC event listeners
  useEffect(() => {
    if (!isConnected) return;
    
    const onSignal = (event: Event) => handleSignal((event as CustomEvent).detail);
    const onRoomUpdate = (event: Event) => handleRoomUpdate((event as CustomEvent).detail.participants);
    
    window.addEventListener('webrtc', onSignal);
    window.addEventListener('roomUpdate', onRoomUpdate);
    
    return () => {
      // Clean up when unmounting
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      
      peersRef.current.forEach(peer => peer.destroy());
      peersRef.current.clear();
      
      window.removeEventListener('webrtc', onSignal);
      window.removeEventListener('roomUpdate', onRoomUpdate);
    };
  }, [isConnected, handleSignal, handleRoomUpdate, localStream]);
  
  // Toggle video on/off
  const toggleVideo = useCallback((enabled: boolean) => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
      updateVideoStatus(userId, enabled);
    }
  }, [localStream, userId, updateVideoStatus]);
  
  // Switch camera
  const switchCamera = useCallback(async (deviceId: string) => {
    if (deviceId === selectedDeviceId) return;
    
    try {
      // Stop current stream
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      
      // Get new stream
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: false
      });
      
      // Update state
      setSelectedDeviceId(deviceId);
      setLocalStream(newStream);
      
      // Update local participant stream
      setParticipants(prev => 
        prev.map(p => p.userId === userId ? { ...p, stream: newStream, hasVideo: true } : p)
      );
      
      // Recreate peer connections
      peersRef.current.forEach((peer, peerId) => {
        peer.destroy();
        peersRef.current.delete(peerId);
        createPeer(peerId, true);
      });
      
      updateVideoStatus(userId, true);
    } catch (err) {
      console.error('[CAMERA] Error switching camera:', err);
    }
  }, [selectedDeviceId, localStream, userId, createPeer, updateVideoStatus]);
  
  return {
    participants,
    localStream,
    toggleVideo,
    videoDevices,
    selectedDeviceId,
    switchCamera
  };
}