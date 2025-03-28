import { useRef, useEffect, useState, useCallback } from "react";
import { ParticipantState } from "@shared/schema";
import { useSocketIO } from "@/hooks/useSocketIO";

interface VideoTileProps {
  participant: ParticipantState;
  isLocal: boolean;
  isDraggable: boolean;
  onDragStart: (e: React.DragEvent, userId: string, position: number) => void;
  onDragOver: (e: React.DragEvent, position: number) => void;
  onDrop: (e: React.DragEvent, position: number) => void;
}

export function VideoTile({ 
  participant, 
  isLocal, 
  isDraggable,
  onDragStart,
  onDragOver,
  onDrop
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [receivedImage, setReceivedImage] = useState<string | null>(null);
  const animationRef = useRef<number | null>(null);
  
  // Get socket connection for receiving frames
  const { socket } = useSocketIO(participant.roomToken || "");
  
  // Connect the stream to the video element when it changes
  useEffect(() => {
    console.log(`[VIDEO] Setting up video for ${participant.nickname} (${isLocal ? 'local' : 'remote'})`);
    console.log(`[VIDEO] hasVideo: ${participant.hasVideo}, hasStream: ${!!participant.stream}`);
    
    // Simply set the srcObject and nothing else
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
    }
    
    // Cleanup when unmounted
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [participant.stream, participant.nickname, isLocal, participant.hasVideo]);
  
  // Handle receiving image frames from server
  useEffect(() => {
    if (!socket || isLocal) return;
    
    const onImageReceived = (data: any) => {
      // Only process images for this participant
      if (data.userId === participant.userId && participant.hasVideo) {
        setReceivedImage(data.image);
        setFrameCount(prev => prev + 1);
      }
    };
    
    socket.on('video:image', onImageReceived);
    
    return () => {
      socket.off('video:image', onImageReceived);
    };
  }, [socket, participant.userId, participant.hasVideo, isLocal]);
  
  // Draw received image to canvas
  useEffect(() => {
    if (!canvasRef.current || !receivedImage) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Create image element
    const img = new Image();
    img.onload = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Add user indicator
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, canvas.height - 30, canvas.width, 30);
      
      // Add frame info
      ctx.fillStyle = 'white';
      ctx.font = '12px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(`Frame: ${frameCount}`, canvas.width - 10, canvas.height - 10);
    };
    img.src = receivedImage;
  }, [receivedImage, frameCount]);
  
  // Set up the canvas-based visualization for video placeholders or when no frame received yet
  useEffect(() => {
    // Don't run this for local video (which uses the real video stream)
    // or if we already received frames from server
    if (isLocal || receivedImage || !participant.hasVideo || !canvasRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    // Create a simple animation to simulate active video while waiting for actual frames
    const animate = () => {
      if (!canvasRef.current) return;
      
      const canvas = canvasRef.current;
      const width = canvas.width;
      const height = canvas.height;
      
      // Fill background
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
      
      // Get initial from nickname
      const initial = participant.nickname?.charAt(0)?.toUpperCase() || "?";
      
      // Create animated effect to show "activity"
      const time = Date.now() / 1000;
      const x = width/2 + Math.sin(time * 0.5) * 20;
      const y = height/2 + Math.cos(time * 0.7) * 15;
      
      // Draw avatar circle that moves slightly
      ctx.beginPath();
      ctx.arc(x, y, 40, 0, Math.PI * 2);
      ctx.fillStyle = '#6366f1';
      ctx.fill();
      
      // Draw initial
      ctx.fillStyle = 'white';
      ctx.font = '36px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, x, y);
      
      // Add info text
      ctx.fillStyle = '#aaa';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`Waiting for video stream...`, width/2, height - 30);
      
      // Draw a simple "signal" indicator to show activity
      const bars = 5;
      const barWidth = 4;
      const barSpacing = 3;
      const barMaxHeight = 15;
      const barX = width - 20;
      const barY = 20;
      
      for (let i = 0; i < bars; i++) {
        // Calculate a height that varies with time and bar position
        const heightPercent = 0.3 + Math.abs(Math.sin(time * 2 + i * 0.7)) * 0.7;
        const barHeight = barMaxHeight * heightPercent;
        
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(
          barX + i * (barWidth + barSpacing),
          barY - barHeight,
          barWidth,
          barHeight
        );
      }
      
      // Track animation
      setFrameCount(prev => prev + 1);
      
      // Schedule next frame
      animationRef.current = requestAnimationFrame(animate);
    };
    
    // Start animation
    animationRef.current = requestAnimationFrame(animate);
    
    // Cleanup
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [participant.hasVideo, participant.nickname, isLocal, receivedImage]);
  
  return (
    <div 
      className={`rounded-lg overflow-hidden border ${isDraggable ? 'draggable-video' : ''} shadow-sm ${
        participant.hasVideo ? 'border-card' : 'border-error'
      }`}
      draggable={isDraggable}
      onDragStart={(e) => onDragStart(e, participant.userId, participant.position)}
      onDragOver={(e) => onDragOver(e, participant.position)}
      onDrop={(e) => onDrop(e, participant.position)}
      data-participant-id={participant.userId}
      data-position={participant.position}
    >
      <div className="video-container relative bg-gray-900 w-full aspect-video">
        {/* Local video stream for local user */}
        {isLocal && participant.hasVideo && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            data-user-id={participant.userId}
          />
        )}
        
        {/* Canvas-based visualization and frame rendering for everyone */}
        <canvas
          ref={canvasRef}
          width={320}
          height={180}
          className={`w-full h-full object-cover ${isLocal && participant.hasVideo ? 'hidden' : ''}`}
        />
        
        {/* Placeholder when video is off */}
        {!participant.hasVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
            <span className="material-icons text-white text-4xl">videocam_off</span>
          </div>
        )}
        
        {/* Nickname badge */}
        <div className="nickname-badge">
          {participant.nickname} {isLocal && "(You)"}
        </div>
        
        {/* Video status indicator */}
        <div className="absolute top-2 right-2 flex items-center">
          <span 
            className={`material-icons ${
              participant.hasVideo ? 'text-success' : 'text-error'
            } bg-black bg-opacity-50 p-1 rounded-full`}
            title={participant.hasVideo ? "Camera On" : "Camera Off"}
          >
            {participant.hasVideo ? "videocam" : "videocam_off"}
          </span>
          
          {/* Server icon to indicate server-processed video */}
          {participant.hasVideo && !isLocal && (
            <span 
              className="material-icons text-blue-400 bg-black bg-opacity-50 p-1 rounded-full ml-1"
              title="Server Processed Video"
            >
              dns
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
