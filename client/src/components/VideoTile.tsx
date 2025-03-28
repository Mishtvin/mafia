import { useRef, useEffect } from "react";
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
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${!participant.hasVideo ? 'hidden' : ''}`}
        />
        
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
        <div className="absolute top-2 right-2">
          <span 
            className={`material-icons ${
              participant.hasVideo ? 'text-success' : 'text-error'
            } bg-black bg-opacity-50 p-1 rounded-full`}
            title={participant.hasVideo ? "Camera On" : "Camera Off"}
          >
            {participant.hasVideo ? "videocam" : "videocam_off"}
          </span>
        </div>
      </div>
    </div>
  );
}
