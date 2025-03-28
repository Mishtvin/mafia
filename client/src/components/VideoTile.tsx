import { useRef, useEffect, useState } from "react";
import { ParticipantState } from "@shared/schema";

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
  const animationRef = useRef<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(!participant.stream && participant.hasVideo);
  
  // Connect the stream to the video element when it changes
  useEffect(() => {
    console.log(`VideoTile for ${participant.nickname}: hasVideo=${participant.hasVideo}, stream=${participant.stream ? 'present' : 'missing'}`);
    
    if (videoRef.current && participant.stream) {
      console.log(`Setting video stream for ${participant.nickname}`);
      videoRef.current.srcObject = participant.stream;
      setIsConnecting(false);
    } else if (participant.hasVideo && !participant.stream) {
      console.log(`Participant ${participant.nickname} has video enabled but no stream yet, showing connecting state`);
      setIsConnecting(true);
    } else {
      console.log(`Participant ${participant.nickname} has video disabled, hiding connecting state`);
      setIsConnecting(false);
    }
    
    // Cleanup when unmounted
    return () => {
      if (videoRef.current) {
        console.log(`Cleaning up video element for ${participant.nickname}`);
        videoRef.current.srcObject = null;
      }
    };
  }, [participant.stream, participant.hasVideo, participant.nickname]);
  
  // Set up the canvas-based visualization for waiting state
  useEffect(() => {
    // Only run for participants with video enabled but no stream yet
    if (!canvasRef.current || !isConnecting) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    // Create a simple animation to show connecting state
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
      
      // Add connecting text
      ctx.fillStyle = '#aaa';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      const dotCount = Math.floor(time % 4);
      const dots = '.'.repeat(dotCount);
      ctx.fillText(`Connecting${dots}`, width/2, height - 30);
      
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
  }, [isConnecting, participant.nickname]);
  
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
        {/* Video element for both local and remote streams */}
        {participant.hasVideo && participant.stream && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            data-user-id={participant.userId}
          />
        )}
        
        {/* Canvas for connecting animation */}
        {isConnecting && (
          <canvas
            ref={canvasRef}
            width={320}
            height={180}
            className="w-full h-full object-cover"
          />
        )}
        
        {/* Placeholder when video is off */}
        {!participant.hasVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
            <div className="flex flex-col items-center">
              <span className="material-icons text-white text-4xl mb-2">videocam_off</span>
              <span className="text-white text-sm">Camera Off</span>
            </div>
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
          
          {/* MediaSoup SFU indicator */}
          {participant.hasVideo && (
            <span 
              className="material-icons text-blue-400 bg-black bg-opacity-50 p-1 rounded-full ml-1"
              title="Server-side WebRTC (MediaSoup)"
            >
              router
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
