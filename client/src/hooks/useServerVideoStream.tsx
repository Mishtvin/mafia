import { useEffect, useState, useRef, useCallback } from 'react';
import { useSocketIO } from './useSocketIO';
import { VideoStreamMetadata } from '@shared/schema';

// Use more modest video quality settings to reduce bandwidth and CPU usage
const videoConfig = {
  width: { ideal: 640, max: 1280 },  // 720p is sufficient for most use cases
  height: { ideal: 480, max: 720 },
  frameRate: { ideal: 24, max: 30 }  // 24-30fps is good for video conferencing
};

interface VideoStream {
  userId: string;
  stream: MediaStream;
  active: boolean;
}

// Custom hook for handling server-based video streaming
export function useServerVideoStream(roomToken: string, userId: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, VideoStream>>(new Map());
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isStreamingToServer, setIsStreamingToServer] = useState(false);
  const frameIdCounter = useRef(0);
  
  // Get Socket.IO connection
  const { 
    isConnected,
    socket,
    updateVideoStatus 
  } = useSocketIO(roomToken);

  // Handle incoming video streams
  useEffect(() => {
    if (!isConnected || !socket) return;
    
    // Handle new stream available notification from server
    const handleNewStream = (data: VideoStreamMetadata) => {
      const { userId, width, height, frameRate } = data;
      
      // Skip if it's our own stream
      // No special handling needed for now
      
      console.log(`[VIDEO] New stream available from ${userId}: ${width}x${height}@${frameRate}fps`);
      
      // Create a MediaStream for this remote participant
      const stream = new MediaStream();
      const videoTrack = createEmptyVideoTrack(width, height);
      stream.addTrack(videoTrack);
      
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        newMap.set(userId, { 
          userId, 
          stream, 
          active: true 
        });
        return newMap;
      });
    };
    
    // Handle video chunk from server
    const handleVideoChunk = (data: any) => {
      const { userId, data: chunkData } = data;
      
      // Skip if it's our own video chunk
      // No special handling needed for now
      
      // Get the remote stream
      const remoteStream = remoteStreams.get(userId);
      if (!remoteStream) return;
      
      // Process video chunk (in a real implementation, this would decode the video chunk)
      // This is a simplified implementation
      // In a real-world scenario, you'd use WebCodecs API or a library to decode the video
      
      // For now, we'll just log that we received a chunk
      console.log(`[VIDEO] Received video chunk from ${userId}, size: ${chunkData.length} bytes`);
    };
    
    // Handle stream ended notification
    const handleStreamEnded = (data: { userId: string }) => {
      const { userId } = data;
      
      console.log(`[VIDEO] Stream ended from ${userId}`);
      
      // Mark stream as inactive or remove it
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        const stream = newMap.get(userId);
        
        if (stream) {
          // Mark as inactive but keep the stream object to avoid UI flicker
          // when the user temporarily turns off their camera
          newMap.set(userId, { ...stream, active: false });
        }
        
        return newMap;
      });
    };
    
    // Register event handlers
    socket.on('video:newStream', handleNewStream);
    socket.on('video:chunk', handleVideoChunk);
    socket.on('video:streamEnded', handleStreamEnded);
    
    // Cleanup on unmount
    return () => {
      socket.off('video:newStream', handleNewStream);
      socket.off('video:chunk', handleVideoChunk);
      socket.off('video:streamEnded', handleStreamEnded);
    };
  }, [isConnected, socket, userId, remoteStreams]);
  
  // Initialize camera stream
  useEffect(() => {
    async function initCamera() {
      if (!isConnected || localStream) return;
      
      try {
        console.log('[CAMERA] Getting initial camera stream with high quality');
        
        const constraints = {
          video: {
            ...videoConfig,
            deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined
          },
          audio: false
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Log the actual constraints we got
        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        console.log(`[CAMERA] Got stream with settings:`, settings);
        
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
  
  // Start sending video to server when local stream is available
  useEffect(() => {
    if (!isConnected || !socket || !localStream || isStreamingToServer) return;
    
    // Get video track settings
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    const settings = videoTrack.getSettings();
    const width = settings.width || 640;
    const height = settings.height || 480;
    const frameRate = settings.frameRate || 30;
    
    // Start streaming to server
    socket.emit('video:start', {
      roomToken,
      userId,
      width,
      height,
      frameRate
    });
    
    setIsStreamingToServer(true);
    
    // Update server about our video status
    updateVideoStatus(userId, true);
    
    // Setup video streaming through the server
    // In a real implementation, this would use WebCodecs API or other
    // methods to capture frames and encode them
    const streamInterval = setInterval(() => {
      // For demonstration purposes only - in a real app you'd use
      // an efficient video encoding system like WebCodecs
      if (socket.connected) {
        const frameId = frameIdCounter.current++;
        
        // Simulate sending video frame
        // In a real implementation, this would be an encoded video frame
        const simulatedData = new Uint8Array(10); // Placeholder for encoded frame data
        
        socket.emit('video:chunk', {
          roomToken,
          userId,
          timestamp: Date.now(),
          data: simulatedData,
          frameId
        });
      }
    }, 1000 / 30); // 30fps
    
    return () => {
      clearInterval(streamInterval);
      if (socket.connected) {
        // Stop streaming when component unmounts
        socket.emit('video:stop', {
          roomToken,
          userId
        });
      }
      setIsStreamingToServer(false);
    };
  }, [isConnected, socket, localStream, isStreamingToServer, roomToken, userId, updateVideoStatus]);
  
  // Toggle video on/off
  const toggleVideo = useCallback((enabled: boolean) => {
    if (!localStream || !socket) return;
    
    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach(track => {
      track.enabled = enabled;
    });
    
    // Update server about video status
    updateVideoStatus(userId, enabled);
    
    // If turning off video, tell server to stop streaming
    if (!enabled && socket.connected) {
      socket.emit('video:stop', {
        roomToken,
        userId
      });
      setIsStreamingToServer(false);
    } 
    // If turning on video and we're not already streaming, start streaming
    else if (enabled && !isStreamingToServer && socket.connected) {
      const videoTrack = videoTracks[0];
      if (!videoTrack) return;
      
      const settings = videoTrack.getSettings();
      socket.emit('video:start', {
        roomToken,
        userId,
        width: settings.width || 640,
        height: settings.height || 480,
        frameRate: settings.frameRate || 30
      });
      setIsStreamingToServer(true);
    }
  }, [localStream, socket, roomToken, userId, updateVideoStatus, isStreamingToServer]);
  
  // Switch camera
  const switchCamera = useCallback(async (deviceId: string) => {
    if (deviceId === selectedDeviceId) return;
    
    try {
      // Stop current stream
      if (localStream) {
        // Tell server we're stopping our stream
        if (socket && socket.connected && isStreamingToServer) {
          socket.emit('video:stop', {
            roomToken,
            userId
          });
          setIsStreamingToServer(false);
        }
        
        // Stop all tracks
        localStream.getTracks().forEach(track => track.stop());
      }
      
      // Get new stream with high quality
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...videoConfig,
          deviceId: { exact: deviceId }
        },
        audio: false
      });
      
      // Update state
      setSelectedDeviceId(deviceId);
      setLocalStream(newStream);
      
      // Tell server about our new stream
      if (socket && socket.connected) {
        const videoTrack = newStream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        
        socket.emit('video:start', {
          roomToken,
          userId,
          width: settings.width || 640,
          height: settings.height || 480,
          frameRate: settings.frameRate || 30
        });
        setIsStreamingToServer(true);
      }
      
      // Update server about our video status
      updateVideoStatus(userId, true);
    } catch (err) {
      console.error('[CAMERA] Error switching camera:', err);
    }
  }, [selectedDeviceId, localStream, roomToken, userId, socket, isStreamingToServer, updateVideoStatus]);
  
  // Get all streams (local + remote) as a participants structure
  const getParticipantsWithStreams = useCallback((participants: any[]) => {
    return participants.map(participant => {
      // For local participant, add the local stream
      if (participant.userId === userId) {
        return {
          ...participant,
          stream: localStream || undefined,
          hasVideo: localStream ? localStream.getVideoTracks()[0]?.enabled : false
        };
      }
      
      // For remote participants, add their stream if available
      const remoteStream = remoteStreams.get(participant.userId);
      return {
        ...participant,
        stream: remoteStream?.stream,
        hasVideo: participant.hasVideo && remoteStream?.active
      };
    });
  }, [userId, localStream, remoteStreams]);
  
  return {
    localStream,
    remoteStreams: Array.from(remoteStreams.values()),
    videoDevices,
    selectedDeviceId,
    toggleVideo,
    switchCamera,
    getParticipantsWithStreams
  };
}

// Helper function to create an empty video track
function createEmptyVideoTrack(width: number, height: number): MediaStreamTrack {
  // Create a canvas element
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  
  // Draw a placeholder in the canvas
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#222222';
    ctx.fillRect(0, 0, width, height);
    
    // Draw text
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Video stream loading...', width / 2, height / 2);
  }
  
  // Get a stream from the canvas
  // @ts-ignore - captureStream() is not in the TS types but is supported in modern browsers
  const stream = canvas.captureStream(30);
  return stream.getVideoTracks()[0];
}