import { useMemo } from "react";
import { useRoomContext } from "@/context/RoomContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface RoomSidebarProps {
  roomToken: string;
  onLeaveRoom: () => void;
}

export function RoomSidebar({ roomToken, onLeaveRoom }: RoomSidebarProps) {
  const { roomState } = useRoomContext();
  const { toast } = useToast();

  const copyRoomLink = () => {
    const url = `${window.location.origin}/room/${roomToken}`;
    navigator.clipboard.writeText(url)
      .then(() => {
        toast({
          title: "Link copied",
          description: "Room link has been copied to clipboard",
        });
      })
      .catch(() => {
        toast({
          title: "Failed to copy",
          description: "Could not copy the room link",
          variant: "destructive",
        });
      });
  };

  // Create initials for participant avatars
  const participantsWithInitials = useMemo(() => {
    return roomState?.participants.map(p => {
      const nameParts = p.nickname.trim().split(' ');
      let initials = '';
      
      if (nameParts.length >= 2) {
        initials = `${nameParts[0].charAt(0)}${nameParts[1].charAt(0)}`;
      } else if (nameParts.length === 1) {
        initials = nameParts[0].substring(0, 2);
      }
      
      return {
        ...p,
        initials: initials.toUpperCase(),
      };
    }) || [];
  }, [roomState?.participants]);

  return (
    <>
      <div className="mb-8">
        <h1 className="text-xl font-medium mb-1">Mafia Game</h1>
        <p className="text-gray-400 text-sm">Video participants</p>
      </div>
      
      <div className="mb-6">
        <h2 className="text-sm uppercase text-gray-400 mb-2">Room Info</h2>
        <div className="bg-opacity-20 bg-white p-3 rounded">
          <div className="mb-2">
            <p className="text-xs text-gray-400">Room Token</p>
            <div className="flex items-center mt-1">
              <span className="text-sm mr-2">{roomToken}</span>
              <button 
                className="text-secondary hover:text-white" 
                title="Copy Room Link"
                onClick={copyRoomLink}
              >
                <span className="material-icons text-sm">content_copy</span>
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400">Participants</p>
            <p className="text-sm mt-1">
              {roomState?.participants.length || 0}/12
            </p>
          </div>
        </div>
      </div>
      
      <div>
        <h2 className="text-sm uppercase text-gray-400 mb-2">Participants</h2>
        <div className="space-y-2">
          {participantsWithInitials.map((participant) => (
            <div 
              key={participant.userId}
              className="flex items-center p-2 rounded hover:bg-white hover:bg-opacity-10"
            >
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-sm mr-2">
                {participant.initials}
              </div>
              <span>{participant.nickname}</span>
            </div>
          ))}
        </div>
      </div>
      
      <div className="mt-auto pt-4">
        <Button 
          variant="destructive" 
          className="w-full" 
          onClick={onLeaveRoom}
        >
          Leave Room
        </Button>
      </div>
    </>
  );
}
