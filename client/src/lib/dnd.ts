import { useCallback } from "react";
import { ParticipantState } from "@shared/schema";

export function useDndSorting(
  participants: ParticipantState[],
  onPositionsChange: (positions: { userId: string, position: number }[]) => void
) {
  // Handle drag start
  const handleDragStart = useCallback((
    e: React.DragEvent, 
    participantId: string, 
    position: number
  ) => {
    // Store the dragged participant's ID and position
    e.dataTransfer.setData("text/plain", JSON.stringify({
      userId: participantId,
      position,
    }));
    
    // Add a dragging class to the element
    const target = e.currentTarget as HTMLElement;
    setTimeout(() => {
      target.classList.add("dragging");
    }, 0);
  }, []);
  
  // Handle drag over
  const handleDragOver = useCallback((
    e: React.DragEvent, 
    position: number
  ) => {
    e.preventDefault();
    
    // Add an active class to the drop zone
    const target = e.currentTarget as HTMLElement;
    target.classList.add("active");
  }, []);
  
  // Handle drop
  const handleDrop = useCallback((
    e: React.DragEvent, 
    targetPosition: number
  ) => {
    e.preventDefault();
    
    // Remove the active class from the drop zone
    const target = e.currentTarget as HTMLElement;
    target.classList.remove("active");
    
    // Get the dragged participant's ID and position
    const dataStr = e.dataTransfer.getData("text/plain");
    
    try {
      const { userId: draggedUserId, position: draggedPosition } = JSON.parse(dataStr);
      
      // If dropping onto the same position, do nothing
      if (draggedPosition === targetPosition) return;
      
      // Find the participant at the target position
      const targetParticipant = participants.find(p => p.position === targetPosition);
      
      // Create position updates
      const positionUpdates = [];
      
      // Update the dragged participant's position
      positionUpdates.push({
        userId: draggedUserId,
        position: targetPosition,
      });
      
      // If there's a participant at the target position, swap positions test
      if (targetParticipant) {
        positionUpdates.push({
          userId: targetParticipant.userId,
          position: draggedPosition,
        });
      }
      
      // Pass the position updates to the callback
      onPositionsChange(positionUpdates);
    } catch (error) {
      console.error("Error processing drop:", error);
    }
  }, [participants, onPositionsChange]);
  
  return {
    handleDragStart,
    handleDragOver,
    handleDrop,
  };
}