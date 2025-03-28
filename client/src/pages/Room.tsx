import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { NicknameForm } from "@/components/NicknameForm";
import { RoomSidebar } from "@/components/RoomSidebar";
import { VideoGrid } from "@/components/VideoGrid";
import { useRoomContext } from "@/context/RoomContext";
import { useSocketIO } from "@/hooks/useSocketIO";
import { useWebRTCWithSocketIO } from "@/hooks/useWebRTCWithSocketIO";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function Room() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { 
    roomState, setRoomState, 
    userId, isRearranging, 
    setIsRearranging, nickname,
    setNickname
  } = useRoomContext();
  const [showNicknameForm, setShowNicknameForm] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [hasVideo, setHasVideo] = useState(true);

  // Setup Socket.IO connection
  const { 
    isConnected,
    joinRoom,
    leaveRoom,
    updateVideoStatus
  } = useSocketIO(token);

  // Setup WebRTC connections with Socket.IO
  const { 
    participants: participantsWithStreams,
    localStream,
    toggleVideo,
    videoDevices,
    selectedDeviceId,
    switchCamera
  } = useWebRTCWithSocketIO(token, userId);

  // Check if room exists on initial load
  useEffect(() => {
    const checkRoom = async () => {
      try {
        const response = await fetch(`/api/rooms/${token}`);
        if (!response.ok) {
          toast({
            title: "Room not found",
            description: "This room may have been closed or does not exist.",
            variant: "destructive",
          });
          setLocation("/");
        } else {
          // Room exists, get initial state
          const roomData = await response.json();
          setRoomState({
            token,
            participants: roomData.participants
          });
        }
      } catch (error) {
        console.error("Error checking room:", error);
        toast({
          title: "Connection error",
          description: "Could not connect to the server. Please try again.",
          variant: "destructive",
        });
        setLocation("/");
      }
    };

    checkRoom();
  }, [token, setLocation, toast, setRoomState]);

  // Handle nickname submission
  const handleNicknameSubmit = useCallback((nickname: string) => {
    setNickname(nickname);
    setShowNicknameForm(false);

    if (isConnected) {
      // Join room with nickname
      joinRoom(nickname, userId);
    }
  }, [isConnected, joinRoom, userId, setNickname]);

  // Update room state when participants change
  useEffect(() => {
    console.log(`[DEBUG ROOM] Room state update effect triggered`);
    console.log(`[DEBUG ROOM] - localStream exists: ${!!localStream}`);
    console.log(`[DEBUG ROOM] - participantsWithStreams count: ${participantsWithStreams.length}`);
    
    if (localStream) {
      console.log(`[DEBUG ROOM] - localStream details:`, {
        active: localStream.active,
        id: localStream.id,
        tracks: localStream.getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState,
          id: t.id,
          label: t.label
        }))
      });
    }
    
    if (roomState) {
      console.log(`[DEBUG ROOM] Current room state participants:`, roomState.participants.map(p => ({
        userId: p.userId, 
        nickname: p.nickname,
        hasVideo: p.hasVideo,
        hasStream: !!p.stream
      })));
      
      // Find the local user in the current room state
      const localParticipant = roomState.participants.find(p => p.userId === userId);
      console.log(`[DEBUG ROOM] Local participant found in roomState: ${!!localParticipant}`);
      
      let updatedParticipants = [...participantsWithStreams];
      
      // If no participants, initialize with the ones from roomState
      if (updatedParticipants.length === 0 && roomState.participants.length > 0) {
        updatedParticipants = [...roomState.participants];
      }
      
      console.log(`[DEBUG ROOM] Initial updatedParticipants:`, updatedParticipants.map(p => ({
        userId: p.userId, 
        nickname: p.nickname,
        hasVideo: p.hasVideo,
        hasStream: !!p.stream
      })));
      
      // If the local user exists in room state but not in updatedParticipants, add them
      if (localParticipant && !updatedParticipants.some(p => p.userId === userId)) {
        console.log(`[DEBUG ROOM] Adding local participant to updatedParticipants`);
        updatedParticipants.push({
          ...localParticipant,
          stream: localStream || undefined,
          hasVideo: !!localStream
        });
      }
      
      // Force add local user if they don't exist in any list
      if (!localParticipant && !updatedParticipants.some(p => p.userId === userId) && nickname) {
        console.log(`[DEBUG ROOM] Force adding local user to participants list`);
        updatedParticipants.push({
          userId,
          nickname,
          position: updatedParticipants.length, // Add at the end
          hasVideo: !!localStream,
          stream: localStream || undefined
        });
      }
      
      // Always ensure the local user has the most up-to-date stream
      // This is especially important after switching cameras
      if (localStream) {
        console.log(`[DEBUG ROOM] Updating stream for local participant in updatedParticipants`);
        let localUserFound = false;
        
        updatedParticipants = updatedParticipants.map(p => {
          if (p.userId === userId) {
            localUserFound = true;
            console.log(`[DEBUG ROOM] Updating stream for ${p.nickname} (local user)`);
            return { ...p, stream: localStream, hasVideo: true };
          }
          return p;
        });
        
        // If still no local user, add them
        if (!localUserFound && nickname) {
          console.log(`[DEBUG ROOM] Still no local user, adding with stream`);
          updatedParticipants.push({
            userId,
            nickname,
            position: updatedParticipants.length, // Add at the end
            hasVideo: true,
            stream: localStream
          });
        }
      }
      
      console.log(`[DEBUG ROOM] Final updatedParticipants:`, updatedParticipants.map(p => ({
        userId: p.userId, 
        nickname: p.nickname,
        hasVideo: p.hasVideo,
        hasStream: !!p.stream,
        streamActive: p.stream?.active,
        streamTracks: p.stream?.getTracks().length
      })));
      
      // Only update if we have participants to show
      if (updatedParticipants.length > 0) {
        setRoomState({
          token,
          participants: updatedParticipants
        });
      }
    }
  }, [participantsWithStreams, localStream, token, userId, roomState, setRoomState, selectedDeviceId, nickname]);

  // Handle video toggle
  const handleToggleVideo = useCallback(() => {
    const newHasVideo = !hasVideo;
    setHasVideo(newHasVideo);
    
    // Toggle video stream
    toggleVideo(newHasVideo);
    
    // Update server about video status
    updateVideoStatus(userId, newHasVideo);
  }, [hasVideo, toggleVideo, updateVideoStatus, userId]);

  // Handle leave room
  const handleLeaveRoom = useCallback(() => {
    // Leave room via Socket.IO
    leaveRoom(userId);
    
    // Redirect to home page
    setLocation("/");
  }, [leaveRoom, userId, setLocation]);

  // Toggle rearrange mode
  const toggleRearrangeMode = useCallback(() => {
    setIsRearranging(!isRearranging);
  }, [isRearranging, setIsRearranging]);

  // If nickname form should be shown
  if (showNicknameForm) {
    return <NicknameForm onSubmit={handleNicknameSubmit} />;
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar for desktop */}
      <div className="bg-sidebar text-white w-64 p-4 hidden md:block">
        <RoomSidebar roomToken={token} onLeaveRoom={handleLeaveRoom} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white shadow-sm p-4 flex justify-between items-center">
          <div className="flex items-center">
            <button 
              className="md:hidden mr-4"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <span className="material-icons">menu</span>
            </button>
            <h1 className="text-xl font-medium text-gray-800">Mafia Game Room</h1>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-sm text-gray-600 flex items-center">
              <span className="material-icons text-success mr-1">person</span>
              <span>{roomState?.participants.length || 0}</span>/12
            </div>
            <Button 
              variant="destructive" 
              className="flex items-center" 
              onClick={handleLeaveRoom}
            >
              <span className="material-icons text-sm mr-1">exit_to_app</span>
              Leave
            </Button>
          </div>
        </header>

        {/* Video grid */}
        <main className="flex-1 overflow-auto p-4 bg-background">
          {/* Controls */}
          <div className="flex flex-wrap justify-between items-center mb-4">
            {/* Camera selector */}
            <div className="flex items-center mb-2 sm:mb-0">
              <label className="mr-2 text-sm font-medium">
                Camera:
              </label>
              <Select
                value={selectedDeviceId}
                onValueChange={switchCamera}
                disabled={videoDevices.length === 0}
              >
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent>
                  {videoDevices.length === 0 ? (
                    <SelectItem value="">No cameras detected</SelectItem>
                  ) : (
                    videoDevices.map(device => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            
            {/* Buttons */}
            <div className="flex">
              <Button 
                className="flex items-center mr-2" 
                onClick={toggleRearrangeMode}
              >
                <span className="material-icons mr-1">drag_indicator</span>
                <span className="hidden sm:inline">Rearrange Webcams</span>
                <span className="sm:hidden">Rearrange</span>
              </Button>
              <Button 
                variant={hasVideo ? "default" : "destructive"}
                className="flex items-center" 
                onClick={handleToggleVideo}
              >
                <span className="material-icons mr-1">
                  {hasVideo ? "videocam" : "videocam_off"}
                </span>
                <span className="hidden sm:inline">{hasVideo ? "Turn Off Camera" : "Turn On Camera"}</span>
                <span className="sm:hidden">{hasVideo ? "Off" : "On"}</span>
              </Button>
            </div>
          </div>

          {/* Rearrange mode notice */}
          {isRearranging && (
            <div className="bg-primary bg-opacity-10 p-3 rounded-lg mb-4 border border-primary border-opacity-30 flex items-center">
              <span className="material-icons text-primary mr-2">info</span>
              <p>You are in webcam rearrange mode. Drag and drop webcams to reorder them. Changes will be seen by all participants.</p>
            </div>
          )}

          {/* Video grid */}
          <VideoGrid />
        </main>
      </div>

      {/* Mobile sidebar */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        >
          <div 
            className="bg-sidebar text-white w-64 h-full p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-xl font-medium">Mafia Game</h1>
              <button onClick={() => setIsMobileSidebarOpen(false)}>
                <span className="material-icons">close</span>
              </button>
            </div>
            <RoomSidebar roomToken={token} onLeaveRoom={handleLeaveRoom} />
          </div>
        </div>
      )}
    </div>
  );
}