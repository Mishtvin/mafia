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
    console.log('MediaSoup state update: ', {
      participants: mediasoup.participants?.length || 0,
      localStream: mediasoup.localStream ? 'present' : 'absent',
      localVideo: mediasoup.localVideo,
      userId: userInfoRef.current?.userId,
      remoteStreams: mediasoup.remoteStreams.size,
    });
    
    let updatedParticipants: ParticipantState[] = [];
    
    // When there are no remote participants but we have a local stream (just us in the room)
    if ((!mediasoup.participants || mediasoup.participants.length === 0) && 
        mediasoup.localStream && mediasoup.localVideo && userInfoRef.current) {
      console.log('Adding local-only participant to the list');
      
      // Create a local-only participant entry
      updatedParticipants = [{
        userId: userInfoRef.current.userId,
        nickname: userInfoRef.current.nickname,
        position: 0,  // Default position for single user
        hasVideo: true,
        stream: mediasoup.localStream,
        roomToken: connectedRoom || undefined
      }];
    } else if (mediasoup.participants && mediasoup.participants.length > 0) {
      // If we have participants from the server
      console.log('Mapping participants from server list:', mediasoup.participants);
      
      updatedParticipants = mediasoup.participants.map(p => {
        // Get remote stream for this participant if available
        const stream = p.id === userInfoRef.current?.userId
          ? mediasoup.localStream
          : mediasoup.remoteStreams.get(p.id);
        
        // For local participant, update hasVideo based on local state
        const hasVideo = p.id === userInfoRef.current?.userId 
          ? mediasoup.localVideo 
          : p.hasVideo;
        
        return {
          userId: p.id,
          nickname: p.nickname,
          position: p.position,
          hasVideo,
          stream: stream || undefined, // Ensure null is converted to undefined
          roomToken: connectedRoom || undefined
        };
      });
    }
    
    console.log('Setting updated participants:', updatedParticipants);
    setParticipants(updatedParticipants);
  }, [
    mediasoup.participants, 
    mediasoup.localStream, 
    mediasoup.localVideo,
    mediasoup.remoteStreams,
    connectedRoom
  ]);
  
  // Track if we're already connected to avoid multiple connections
  const isConnectedRef = useRef<boolean>(false);
  
  // Connect to a room
  const connect = useCallback(async (roomToken: string, userId: string, nickname: string) => {
    // If we're already connected to this room with this user, don't reconnect
    if (isConnectedRef.current && connectedRoom === roomToken && 
        userInfoRef.current?.userId === userId && userInfoRef.current?.nickname === nickname) {
      console.log('Already connected to room with same parameters, skipping reconnect');
      return;
    }
    
    // Update user info reference
    userInfoRef.current = { userId, nickname };
    
    // Connect to mediasoup
    console.log(`Connecting to room ${roomToken} with user ${userId} (${nickname})`);
    await mediasoup.connect(roomToken, userId, nickname);
    
    // Set room and connection status
    setConnectedRoom(roomToken);
    isConnectedRef.current = true;
    console.log(`Connection to room ${roomToken} complete`);
  }, [mediasoup, connectedRoom]);
  
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