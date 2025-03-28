import { useEffect, useState, useRef, useCallback } from 'react';
import { useSocketIO } from './useSocketIO';
import { VideoStreamMetadata } from '@shared/schema';

// Use very modest video quality settings to reduce bandwidth and CPU usage for large groups
const videoConfig = {
  width: { ideal: 320, max: 640 },    // 320p is sufficient to see people clearly
  height: { ideal: 240, max: 480 },   // Low resolution reduces bandwidth significantly
  frameRate: { ideal: 15, max: 24 }   // 15fps is good enough for video conferencing with many participants
};

// Configuration for canvas-based video capture
const canvasConfig = {
  captureInterval: 1000 / 15,  // Capture at 15fps
  quality: 0.6,                // JPEG quality (0-1)
  maxSize: 40 * 1024,          // 40KB max for each frame
  resizeWidth: 320,            // Width to resize captured frames to
  resizeHeight: 240            // Height to resize captured frames to
};

interface VideoStream {
  userId: string;
  stream: MediaStream;
  active: boolean;
  lastUpdateTime?: number;
}

// Custom hook for handling server-based video streaming
export function useServerVideoStream(roomToken: string, userId: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, VideoStream>>(new Map());
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isStreamingToServer, setIsStreamingToServer] = useState(false);
  const [hasVideoEnabled, setHasVideoEnabled] = useState(false);
  const frameIdCounter = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  
  // Get Socket.IO connection
  const { 
    isConnected,
    socket,
    updateVideoStatus 
  } = useSocketIO(roomToken);

  // Handle incoming video streams
  useEffect(() => {
    if (!isConnected || !socket) return;

    // Create a map to track activeStreams using userId as key
    const activeStreams = new Map<string, boolean>();
    
    // Handle new stream available notification from server
    const handleNewStream = (data: VideoStreamMetadata) => {
      const { userId: streamUserId, width, height, frameRate } = data;

      console.log(`[VIDEO] New stream available from ${streamUserId}: ${width}x${height}@${frameRate}fps`);
      
      if (streamUserId === userId) {
        // This is our own stream coming back from the server
        // No special handling needed
        console.log('[VIDEO] Received my own stream notification from server');
        return;
      }
      
      // Create a MediaStream for this remote participant
      const stream = new MediaStream();
      const videoTrack = createEmptyVideoTrack(width || 320, height || 240);
      stream.addTrack(videoTrack);
      
      // Track that this user has an active stream
      activeStreams.set(streamUserId, true);
      
      // Update remote streams map with this new stream
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        newMap.set(streamUserId, { 
          userId: streamUserId, 
          stream, 
          active: true 
        });
        return newMap;
      });
    };
    
    // Handle video chunk from server
    const handleVideoChunk = (data: any) => {
      const { userId: chunkUserId, frameId, timestamp } = data;
      
      if (chunkUserId === userId) {
        // No need to process our own video chunks
        return;
      }
      
      // Keep track of active streams
      activeStreams.set(chunkUserId, true);
      
      // Update the remote stream active status just to keep it marked as "alive"
      const currentStream = remoteStreams.get(chunkUserId);
      if (currentStream) {
        // Always update the lastUpdateTime to prevent timeouts
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          const stream = newMap.get(chunkUserId);
          if (stream) {
            newMap.set(chunkUserId, { 
              ...stream, 
              active: true,
              lastUpdateTime: timestamp || Date.now()
            });
          }
          return newMap;
        });
      } else {
        // If we don't have a stream yet but are receiving chunks,
        // this means the initialization message was lost or delayed.
        // Set up a minimal stream to display something.
        console.log(`[VIDEO] Creating placeholder stream for user ${chunkUserId} who is sending chunks`);
        
        // Create a placeholder stream
        const newStream = new MediaStream();
        const placeholderTrack = createEmptyVideoTrack(320, 240);
        newStream.addTrack(placeholderTrack);
        
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          newMap.set(chunkUserId, {
            userId: chunkUserId,
            stream: newStream,
            active: true,
            lastUpdateTime: timestamp || Date.now()
          });
          return newMap;
        });
      }
      
      // Log heartbeat frames for debugging
      if (frameId && frameId % 100 === 0) {
        console.log(`[VIDEO] Received heartbeat frame #${frameId} from ${chunkUserId}`);
      }
    };
    
    // Handle image frame from server
    const handleVideoImage = (data: { userId: string, image: string, timestamp: number, frameId?: number }) => {
      const { userId: imageUserId, image, timestamp, frameId } = data;
      
      console.log(`[VIDEO] Received image frame #${frameId || 'unknown'} from ${imageUserId} at ${new Date(timestamp).toISOString()}`);
      
      if (imageUserId === userId) {
        // No need to process our own video image
        return;
      }
      
      // Get the remote stream for this user
      let currentStream = remoteStreams.get(imageUserId);
      
      // If we don't have a stream for this user yet, create one
      if (!currentStream) {
        console.log(`[VIDEO] Creating new stream for user ${imageUserId}`);
        const newStream = new MediaStream();
        // Create a placeholder track initially
        const videoTrack = createEmptyVideoTrack(320, 240);
        newStream.addTrack(videoTrack);
        
        // Add to remote streams map
        // Create a properly typed VideoStream object
        currentStream = {
          userId: imageUserId,
          stream: newStream,
          active: true,
          lastUpdateTime: Date.now()
        };
        
        // Use a non-null assertion since we just created the object
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          // We've just created currentStream above, so we know it's not undefined
          newMap.set(imageUserId, currentStream!);
          return newMap;
        });
      }
      
      try {
        // Create an HTML Image element to load the frame
        const imageElement = new Image();
        
        // Log the image data size
        if (frameId && frameId % 60 === 0) {
          console.log(`[VIDEO] Received frame #${frameId} - data size: ${Math.round(image.length / 1024)}kb`);
        }
        
        imageElement.onload = () => {
          // Create a canvas to draw the image
          const canvas = document.createElement('canvas');
          canvas.width = imageElement.width || 320;
          canvas.height = imageElement.height || 240;
          
          // Draw the image to the canvas
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(imageElement, 0, 0);
          
          // Try the new approach - create a fresh stream from the canvas for each frame
          try {
            // Create a new stream from this canvas
            // @ts-ignore - captureStream is not in the TS types but supported in browsers
            const newStream = canvas.captureStream(15);
            const newVideoTrack = newStream.getVideoTracks()[0];
            
            if (newVideoTrack && currentStream.stream) {
              // Replace all existing tracks with the new one
              const oldTracks = currentStream.stream.getVideoTracks();
              oldTracks.forEach(track => {
                currentStream.stream.removeTrack(track);
                track.stop();
              });
              
              // Add the new track
              currentStream.stream.addTrack(newVideoTrack);
              
              // Log success
              if (frameId && frameId % 60 === 0) {
                console.log(`[VIDEO] Successfully updated video track for user ${imageUserId} (frame #${frameId})`);
              }
            }
          } catch (err) {
            console.error('[VIDEO] Error creating stream from canvas:', err);
            
            // Fall back to finding and updating the video element directly
            try {
              // Find the video element for this stream
              const videoElements = document.querySelectorAll('video');
              const videoElementsArray = Array.from(videoElements);
              
              for (let i = 0; i < videoElementsArray.length; i++) {
                const videoEl = videoElementsArray[i];
                if (videoEl.srcObject === currentStream.stream) {
                  // Try to set a new source if we can't update the existing one
                  // @ts-ignore
                  if (typeof videoEl.getContext !== 'function') {
                    const newVideoStream = canvas.captureStream(15);
                    videoEl.srcObject = newVideoStream;
                    
                    // Update our reference
                    currentStream.stream = newVideoStream;
                  }
                  break;
                }
              }
            } catch (e) {
              console.error('[VIDEO] Fallback method also failed:', e);
            }
          }
          
          // Mark the stream as active
          setRemoteStreams(prev => {
            const newMap = new Map(prev);
            newMap.set(imageUserId, { 
              ...currentStream, 
              active: true,
              lastUpdateTime: Date.now()
            });
            return newMap;
          });
        };
        
        // Set error handler
        imageElement.onerror = (err) => {
          console.error('[VIDEO] Error loading image:', err);
        };
        
        // Trigger the image load
        imageElement.src = image;
      } catch (err) {
        console.error('[VIDEO] Error processing image frame:', err);
      }
    };
    
    // Handle stream ended notification
    const handleStreamEnded = (data: { userId: string }) => {
      const { userId: endedUserId } = data;
      
      console.log(`[VIDEO] Stream ended from ${endedUserId}`);
      
      // Remove from active streams tracking
      activeStreams.delete(endedUserId);
      
      // Mark stream as inactive
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        const stream = newMap.get(endedUserId);
        
        if (stream) {
          // Mark as inactive but keep the stream object to avoid UI flicker
          // when the user temporarily turns off their camera
          newMap.set(endedUserId, { ...stream, active: false });
        }
        
        return newMap;
      });
    };
    
    // Handle room updates (for video status changes)
    const handleRoomUpdate = (data: any) => {
      // Process video status changes from room update
      if (data && data.participants) {
        data.participants.forEach((p: any) => {
          // Check if participant changed video status
          const remoteStream = remoteStreams.get(p.userId);
          
          // Only update for remote participants
          if (p.userId !== userId && remoteStream) {
            const isActive = p.hasVideo && activeStreams.get(p.userId);
            
            // If video status or active state needs to be updated
            if (remoteStream.active !== isActive) {
              setRemoteStreams(prev => {
                const newMap = new Map(prev);
                const stream = newMap.get(p.userId);
                if (stream) {
                  newMap.set(p.userId, { ...stream, active: isActive });
                }
                return newMap;
              });
            }
          }
        });
      }
    };
    
    // Register event handlers
    socket.on('video:newStream', handleNewStream);
    socket.on('video:chunk', handleVideoChunk);
    socket.on('video:image', handleVideoImage);
    socket.on('video:streamEnded', handleStreamEnded);
    socket.on('roomUpdate', handleRoomUpdate);
    
    // Cleanup on unmount
    return () => {
      socket.off('video:newStream', handleNewStream);
      socket.off('video:chunk', handleVideoChunk);
      socket.off('video:image', handleVideoImage);
      socket.off('video:streamEnded', handleStreamEnded);
      socket.off('roomUpdate', handleRoomUpdate);
    };
  }, [isConnected, socket, userId, remoteStreams]);
  
  // Initialize camera stream
  useEffect(() => {
    async function initCamera() {
      if (!isConnected || localStream) return;
      
      try {
        console.log('[CAMERA] Getting initial camera stream with reduced quality for 12+ participants');
        
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
        setHasVideoEnabled(true);
        
        // Enumerate devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');
        setVideoDevices(videoInputs);
        
        if (videoInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch (err) {
        console.error('[CAMERA] Error initializing camera:', err);
        // Create a placeholder stream for UI consistency
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        // @ts-ignore
        const placeholderStream = canvas.captureStream(15);
        setLocalStream(placeholderStream);
        setHasVideoEnabled(false);
      }
    }
    
    initCamera();
  }, [isConnected, localStream, selectedDeviceId]);
  
  // Start sending video to server when local stream is available
  useEffect(() => {
    if (!isConnected || !socket || !localStream || isStreamingToServer || !hasVideoEnabled) return;
    
    // Get video track settings
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    const settings = videoTrack.getSettings();
    const width = settings.width || 320;
    const height = settings.height || 240;
    const frameRate = settings.frameRate || 15;
    
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
    
    // Setup actual video streaming to server
    // We'll capture frames from the video element using canvas and send them as JPEG images
    
    // Create a canvas for capturing frames
    const canvas = document.createElement('canvas');
    canvas.width = canvasConfig.resizeWidth;
    canvas.height = canvasConfig.resizeHeight;
    const ctx = canvas.getContext('2d');
    
    // Create a video element to connect to the stream
    const videoEl = document.createElement('video');
    videoEl.srcObject = localStream;
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.play().catch(err => console.error('[VIDEO] Error playing video for frame capture:', err));
    
    let lastFrameTime = performance.now();
    
    const sendFrame = () => {
      if (!socket.connected || !hasVideoEnabled || !ctx) {
        animationFrameRef.current = null;
        return;
      }
      
      const now = performance.now();
      const elapsed = now - lastFrameTime;
      
      // Only send frames at the target frame rate to reduce load
      if (elapsed >= canvasConfig.captureInterval) {
        const frameId = frameIdCounter.current++;
        
        try {
          // Draw the current video frame to canvas
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          
          // Convert to JPEG and send as base64 string
          // This is much more efficient than sending raw pixel data
          const imageData = canvas.toDataURL('image/jpeg', canvasConfig.quality);
          
          // Log the size of data for debugging
          if (frameId % 60 === 0) {
            console.log(`[VIDEO] Sending frame #${frameId} - data size: ${Math.round(imageData.length / 1024)}kb`);
          }

          // Always send full image - this is more reliable for testing
          // For every X frames, send a full image to all participants
          if (frameId % 10 === 0) {
            // Send the image as a separate event that's optimized for images
            socket.emit('video:image', {
              roomToken,
              userId,
              image: imageData,
              timestamp: Date.now(),
              frameId
            });
          } else {
            // Send a small ping to keep the connection active
            socket.emit('video:chunk', {
              roomToken,
              userId,
              timestamp: Date.now(),
              data: new Uint8Array(4), // Just a heartbeat
              frameId
            });
          }
        } catch (err) {
          console.error('[VIDEO] Error capturing frame:', err);
        }
        
        lastFrameTime = now;
      }
      
      // Schedule next frame
      animationFrameRef.current = requestAnimationFrame(sendFrame);
    };
    
    // Start the frame sending loop
    animationFrameRef.current = requestAnimationFrame(sendFrame);
    
    return () => {
      // Clean up animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Tell server we're stopping the stream
      if (socket.connected) {
        socket.emit('video:stop', {
          roomToken,
          userId
        });
      }
      
      setIsStreamingToServer(false);
    };
  }, [isConnected, socket, localStream, isStreamingToServer, roomToken, userId, updateVideoStatus, hasVideoEnabled]);
  
  // Toggle video on/off
  const toggleVideo = useCallback((enabled: boolean) => {
    if (!localStream || !socket) return;
    
    // Update state tracking
    setHasVideoEnabled(enabled);
    
    // Update video tracks
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
      
      // Cancel animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    } 
    // If turning on video and we're not already streaming, start streaming
    else if (enabled && !isStreamingToServer && socket.connected) {
      const videoTrack = videoTracks[0];
      if (!videoTrack) return;
      
      const settings = videoTrack.getSettings();
      socket.emit('video:start', {
        roomToken,
        userId,
        width: settings.width || 320,
        height: settings.height || 240,
        frameRate: settings.frameRate || 15
      });
      setIsStreamingToServer(true);
    }
  }, [localStream, socket, roomToken, userId, updateVideoStatus, isStreamingToServer]);
  
  // Switch camera
  const switchCamera = useCallback(async (deviceId: string) => {
    if (deviceId === selectedDeviceId) return;
    
    // Handle the special "no-camera" value
    if (deviceId === "no-camera" || deviceId === "camera-id-missing") {
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
        
        // Cancel animation frame
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        
        // Stop all tracks
        localStream.getTracks().forEach(track => track.stop());
        
        // Create a placeholder canvas stream
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        
        // Draw a placeholder in the canvas
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#222222';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw text
          ctx.fillStyle = '#aaaaaa';
          ctx.font = '20px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('No camera selected', canvas.width / 2, canvas.height / 2);
        }
        
        // @ts-ignore - captureStream() is not in the TS types but is supported in modern browsers
        const placeholderStream = canvas.captureStream(15);
        setLocalStream(placeholderStream);
        setHasVideoEnabled(false);
        setSelectedDeviceId(deviceId);
        
        // Update server about our video status
        updateVideoStatus(userId, false);
      }
      return;
    }
    
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
        
        // Cancel animation frame
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        
        // Stop all tracks
        localStream.getTracks().forEach(track => track.stop());
      }
      
      // Get new stream with modest quality
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
      setHasVideoEnabled(true);
      
      // Tell server about our new stream
      if (socket && socket.connected) {
        const videoTrack = newStream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        
        socket.emit('video:start', {
          roomToken,
          userId,
          width: settings.width || 320,
          height: settings.height || 240,
          frameRate: settings.frameRate || 15
        });
        setIsStreamingToServer(true);
      }
      
      // Update server about our video status
      updateVideoStatus(userId, true);
    } catch (err) {
      console.error('[CAMERA] Error switching camera:', err);
      setHasVideoEnabled(false);
      updateVideoStatus(userId, false);
    }
  }, [selectedDeviceId, localStream, roomToken, userId, socket, isStreamingToServer, updateVideoStatus]);
  
  // Get all streams (local + remote) as a participants structure
  const getParticipantsWithStreams = useCallback((participants: any[]) => {
    console.log('[DEBUG ROOM] Initial updatedParticipants:', participants);
    
    const updatedParticipants = participants.map(participant => {
      // For local participant, add the local stream
      if (participant.userId === userId) {
        console.log('[DEBUG ROOM] Updating stream for local participant in updatedParticipants');
        console.log('[DEBUG ROOM] Updating stream for ' + participant.nickname + ' (local user)');
        
        return {
          ...participant,
          stream: localStream || undefined,
          hasStream: !!localStream,
          streamActive: !!localStream && hasVideoEnabled,
          streamTracks: localStream?.getVideoTracks().length || 0,
          roomToken: roomToken
        };
      }
      
      // For remote participants, add their stream if available
      const remoteStream = remoteStreams.get(participant.userId);
      return {
        ...participant,
        stream: remoteStream?.stream,
        hasStream: !!remoteStream?.stream,
        streamActive: remoteStream?.active || false,
        roomToken: roomToken
      };
    });
    
    console.log('[DEBUG ROOM] Final updatedParticipants:', updatedParticipants);
    return updatedParticipants;
  }, [userId, localStream, remoteStreams, hasVideoEnabled, roomToken]);
  
  return {
    localStream,
    remoteStreams: Array.from(remoteStreams.values()),
    videoDevices,
    selectedDeviceId,
    toggleVideo,
    switchCamera,
    getParticipantsWithStreams,
    hasVideoEnabled
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
    ctx.fillText('Video stream connecting...', width / 2, height / 2);
  }
  
  // Get a stream from the canvas
  // @ts-ignore - captureStream() is not in the TS types but is supported in modern browsers
  const stream = canvas.captureStream(15);
  return stream.getVideoTracks()[0];
}