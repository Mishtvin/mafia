import { useState, useEffect, useCallback, useRef } from 'react';
import { useMediasoupClient } from './useMediasoupClient';
import { type ParticipantState } from '@shared/schema';

interface VideoTrackHookResult {
  participants: ParticipantState[];
  localParticipant: ParticipantState | null;
  hasVideoEnabled: boolean;
  error: string | null;
  selectCamera: (deviceId: string) => Promise<void>;
  toggleVideo: () => Promise<void>;
  connect: (roomToken: string, userId: string, nickname: string) => Promise<void>;
  updateParticipantPosition: (userId: string, position: number) => void;
}

export function useVideoTracks(): VideoTrackHookResult {
  const [participants, setParticipants] = useState<ParticipantState[]>([]);
  const [videoInputDevices, setVideoInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [connectedRoom, setConnectedRoom] = useState<string | null>(null);
  const userInfoRef = useRef<{ userId: string, nickname: string } | null>(null);
  
  // Use the mediasoup client hook
  const mediasoup = useMediasoupClient();
  
  // Initialize by getting available devices
  useEffect(() => {
    async function getDevices() {
      try {
        // Request permission to access media devices
        await navigator.mediaDevices.getUserMedia({ video: true })
          .then(stream => {
            // Stop all tracks immediately after getting permissions
            stream.getTracks().forEach(track => track.stop());
          });
        
        // Get all video input devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setVideoInputDevices(videoDevices);
        
        // Select the first device by default
        if (videoDevices.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoDevices[0].deviceId);
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
      }
    }
    
    getDevices();
    
    // Set up device change listener
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, []);
  
  // Convert mediasoup participants and streams to our ParticipantState format
  useEffect(() => {
    if (!mediasoup.participants || mediasoup.participants.length === 0) {
      return;
    }
    
    const updatedParticipants: ParticipantState[] = mediasoup.participants.map(p => {
      // Get remote stream for this participant if available
      const stream = p.id === userInfoRef.current?.userId
        ? mediasoup.localStream
        : mediasoup.remoteStreams.get(p.id);
      
      return {
        userId: p.id,
        nickname: p.nickname,
        position: p.position,
        hasVideo: p.hasVideo,
        stream: stream || undefined, // Ensure null is converted to undefined
        roomToken: connectedRoom || undefined
      };
    });
    
    setParticipants(updatedParticipants);
  }, [
    mediasoup.participants, 
    mediasoup.localStream, 
    mediasoup.remoteStreams,
    connectedRoom
  ]);
  
  // Connect to a room
  const connect = useCallback(async (roomToken: string, userId: string, nickname: string) => {
    userInfoRef.current = { userId, nickname };
    await mediasoup.connect(roomToken, userId, nickname);
    setConnectedRoom(roomToken);
  }, [mediasoup]);
  
  // Select a camera
  const selectCamera = useCallback(async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    
    // If video is already enabled, restart it with the new device
    if (mediasoup.localVideo) {
      // Stop current video
      mediasoup.stopLocalVideo();
      
      // Start with new device after a small delay
      setTimeout(async () => {
        await mediasoup.startLocalVideo();
      }, 500);
    }
  }, [mediasoup]);
  
  // Toggle video
  const toggleVideo = useCallback(async () => {
    if (mediasoup.localVideo) {
      mediasoup.stopLocalVideo();
    } else {
      await mediasoup.startLocalVideo();
    }
  }, [mediasoup]);
  
  // Update participant position
  const updateParticipantPosition = useCallback((userId: string, position: number) => {
    if (userId === userInfoRef.current?.userId) {
      mediasoup.updatePosition(position);
    }
  }, [mediasoup]);
  
  // Find the local participant
  const localParticipant = participants.find(
    p => p.userId === userInfoRef.current?.userId
  ) || null;
  
  return {
    participants,
    localParticipant,
    hasVideoEnabled: mediasoup.localVideo,
    error: mediasoup.error,
    selectCamera,
    toggleVideo,
    connect,
    updateParticipantPosition
  };
}