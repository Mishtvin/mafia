import { useCallback } from "react";
import { useRoomContext } from "@/context/RoomContext";
import { VideoTile } from "@/components/VideoTile";
import { EmptySlot } from "@/components/EmptySlot";
import { useDndSorting } from "@/lib/dnd";
import { useSocketIO } from "@/hooks/useSocketIO";

export function VideoGrid() {
  const { roomState, userId, isRearranging } = useRoomContext();
  const { updatePositions } = useSocketIO(roomState?.token || "");
  
  // Initialize drag and drop functionality with the new hook
  const { handleDragStart, handleDragOver, handleDrop } = useDndSorting(
    roomState?.participants || [],
    (positions) => {
      if (positions.length > 0 && roomState?.token) {
        updatePositions(positions);
      }
    }
  );

  // Get participants and empty slots
  const getVideosAndEmptySlots = useCallback(() => {
    if (!roomState) {
      console.log(`[DEBUG GRID] roomState is null, returning empty grid`);
      return { videos: [], emptySlots: Array(12).fill(null) };
    }
    
    console.log(`[DEBUG GRID] Room has ${roomState.participants.length} participants`);
    
    // Log participants with stream info
    console.log(`[DEBUG GRID] Participants details:`, 
      roomState.participants.map(p => ({
        userId: p.userId,
        nickname: p.nickname,
        position: p.position,
        hasVideo: p.hasVideo,
        hasStream: !!p.stream,
        isLocal: p.userId === userId,
        streamActive: p.stream?.active,
        streamTracks: p.stream?.getTracks().length
      }))
    );
    
    // Check for participants with missing streams when they should have video
    const missingStreamParticipants = roomState.participants.filter(p => p.hasVideo && !p.stream);
    if (missingStreamParticipants.length > 0) {
      console.warn(`[DEBUG GRID] Warning: ${missingStreamParticipants.length} participants have hasVideo=true but no stream:`, 
        missingStreamParticipants.map(p => p.nickname)
      );
    }
    
    // Sort participants by position
    const sortedParticipants = [...roomState.participants].sort(
      (a, b) => a.position - b.position
    );
    
    // Make sure all positions are valid (0 to 11)
    sortedParticipants.forEach(p => {
      if (p.position < 0 || p.position > 11) {
        console.warn(`[DEBUG GRID] Warning: Participant ${p.nickname} has invalid position ${p.position}`);
      }
    });
    
    // Find occupied positions
    const occupiedPositions = new Set(sortedParticipants.map(p => p.position));
    
    // Create empty slots for unoccupied positions
    const emptySlots = [];
    for (let i = 0; i < 12; i++) {
      if (!occupiedPositions.has(i)) {
        emptySlots.push(i);
      }
    }
    
    console.log(`[DEBUG GRID] Final grid: ${sortedParticipants.length} videos, ${emptySlots.length} empty slots`);
    
    return { videos: sortedParticipants, emptySlots };
  }, [roomState, userId]);
  
  const { videos, emptySlots } = getVideosAndEmptySlots();

  // If we have no participants at all, show a placeholder message
  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 p-8 bg-gray-100 rounded-lg border border-gray-200">
        <div className="material-icons text-gray-400 text-6xl mb-4">groups_off</div>
        <h3 className="text-xl font-medium text-gray-800 mb-2">No Participants Yet</h3>
        <p className="text-gray-600 text-center max-w-md">
          Share the room link with others to invite them to join this video conference.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {/* Render video tiles for participants */}
      {videos.map((participant) => (
        <VideoTile
          key={participant.userId}
          participant={participant}
          isLocal={participant.userId === userId}
          isDraggable={isRearranging}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      ))}
      
      {/* Render empty slots */}
      {emptySlots.map((position) => (
        <EmptySlot
          key={`empty-${position}`}
          position={position}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}