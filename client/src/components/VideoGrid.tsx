import { useCallback } from "react";
import { useRoomContext } from "@/context/RoomContext";
import { VideoTile } from "@/components/VideoTile";
import { EmptySlot } from "@/components/EmptySlot";
import { useDndSorting } from "@/lib/dnd";
import { useVideoTracks } from "@/hooks/useVideoTracks";

export function VideoGrid() {
  const { roomState, userId, isRearranging } = useRoomContext();
  const { updateParticipantPosition } = useVideoTracks();
  
  // Initialize drag and drop functionality with the new hook
  const { handleDragStart, handleDragOver, handleDrop } = useDndSorting(
    roomState?.participants || [],
    (positions) => {
      if (positions.length > 0) {
        // Update each participant's position via mediasoup
        positions.forEach(pos => {
          updateParticipantPosition(pos.userId, pos.position);
        });
      }
    }
  );

  // Get participants and empty slots with additional validation
  const getVideosAndEmptySlots = useCallback(() => {
    // Safety check for roomState
    if (!roomState || !roomState.participants || !Array.isArray(roomState.participants)) {
      console.log('No room state or empty participants array, showing empty grid');
      return { videos: [], emptySlots: Array(12).fill(null).map((_, i) => i) };
    }
    
    // Log for debugging
    console.log('Rendering VideoGrid with participants:', roomState.participants);
    
    // Sort participants by position
    const sortedParticipants = [...roomState.participants]
      .filter(p => p && typeof p === 'object') // Filter out any invalid participants
      .sort((a, b) => a.position - b.position);
    
    // Make sure all positions are valid (0 to 11)
    sortedParticipants.forEach(p => {
      if (p.position < 0 || p.position > 11) {
        console.warn(`Warning: Participant ${p.nickname} has invalid position ${p.position}`);
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
    
    console.log(`Found ${sortedParticipants.length} participants and ${emptySlots.length} empty slots`);
    return { videos: sortedParticipants, emptySlots };
  }, [roomState]);
  
  const { videos, emptySlots } = getVideosAndEmptySlots();

  // If we have no participants at all, show a placeholder message with helpful instructions
  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 p-8 bg-gray-100 rounded-lg border border-gray-200">
        <div className="material-icons text-gray-400 text-6xl mb-4">groups_off</div>
        <h3 className="text-xl font-medium text-gray-800 mb-2">No Participants Yet</h3>
        <p className="text-gray-600 text-center max-w-md mb-4">
          You are the first one here! Turn on your camera to see yourself in the grid.
        </p>
        <div className="bg-blue-50 p-3 rounded-md border border-blue-200 w-full max-w-md">
          <h4 className="font-medium text-blue-800 flex items-center mb-1">
            <span className="material-icons text-blue-600 mr-1 text-sm">info</span> 
            Quick Tips
          </h4>
          <ul className="text-sm text-blue-700 list-disc pl-5 space-y-1">
            <li>Click the "Turn On Camera" button above to start your webcam</li>
            <li>Share the room URL with others to invite them</li>
            <li>You can rearrange videos by dragging them once more people join</li>
          </ul>
        </div>
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