import React from "react";

interface EmptySlotProps {
  position: number;
  onDragOver: (e: React.DragEvent, position: number) => void;
  onDrop: (e: React.DragEvent, position: number) => void;
}

export function EmptySlot({ position, onDragOver, onDrop }: EmptySlotProps) {
  return (
    <div
      className="rounded-lg overflow-hidden border border-dashed border-gray-300 bg-white drop-zone"
      data-slot-id={position}
      data-position={position}
      onDragOver={(e) => onDragOver(e, position)}
      onDrop={(e) => onDrop(e, position)}
    >
      <div className="video-container w-full flex items-center justify-center bg-gray-100">
        <div className="text-center p-4">
          <span className="material-icons text-4xl text-gray-400">person_add</span>
          <p className="text-gray-500 mt-2">Empty Slot</p>
        </div>
      </div>
    </div>
  );
}
