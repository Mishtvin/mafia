import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { NicknameForm } from "@/components/NicknameForm";
import { RoomSidebar } from "@/components/RoomSidebar";
import { VideoGrid } from "@/components/VideoGrid";
import { useRoomContext } from "@/context/RoomContext";
// MediaSoup hook for WebRTC video streaming
import { useVideoTracks } from "@/hooks/useVideoTracks";
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

  // Setup mediasoup video streaming
  const { 
    participants: mediasoupParticipants,
    localParticipant,
    hasVideoEnabled,
    selectCamera,
    toggleVideo,
    connect: connectToMediasoup,
    updateParticipantPosition
  } = useVideoTracks();
  
  // Get video device information from the hook
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  
  // Get video devices and track changes
  useEffect(() => {
    async function getDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');
        setVideoDevices(videoInputs);
        
        // Select first device if none selected
        if (videoInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch (error) {
        console.error('Error getting video devices:', error);
      }
    }
    
    // Initial device enumeration
    getDevices();
    
    // Set up device change listener
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, [selectedDeviceId]);
  
  // Switch camera handler
  const switchCamera = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    await selectCamera(deviceId);
  };
  
  // Track connection status to avoid multiple connect/disconnect cycles
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  // Connect to mediasoup on room join - only once when requirements are met
  useEffect(() => {
    // Only connect if not already connected or connecting, and we have all required info
    if (token && userId && nickname && !showNicknameForm && !isConnecting && !isConnected) {
      console.log('Connecting to room with mediasoup...', { token, userId, nickname });
      
      // Set connecting flag to prevent multiple connect attempts
      setIsConnecting(true);
      
      connectToMediasoup(token, userId, nickname)
        .then(() => {
          console.log('Successfully connected to mediasoup');
          setIsConnected(true);
          setIsConnecting(false);
          
          // Start local video after connection is established
          return toggleVideo();
        })
        .catch(error => {
          console.error('Error connecting to video server:', error);
          setIsConnecting(false);
          
          toast({
            title: "Connection error",
            description: "Could not connect to video server. Please try again.",
            variant: "destructive",
          });
        });
    }
  }, [token, userId, nickname, showNicknameForm, isConnecting, isConnected, connectToMediasoup, toggleVideo, toast]);
  
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
  }, [setNickname]);

  // Update room state when mediasoup participants change with special handling for local participant
  useEffect(() => {
    console.log('Room received participants update:', mediasoupParticipants);
    
    // Always update with the latest participants data
    setRoomState({
      token,
      participants: mediasoupParticipants
    });
    
    // If we have local video but no participants, ensure we're added to the participants list
    if (mediasoupParticipants.length > 0 || hasVideoEnabled) {
      console.log('Video state changed, updating room state with all participants');
    } else {
      console.log('No participants yet and no local video');
    }
  }, [mediasoupParticipants, token, setRoomState, hasVideoEnabled]);

  // Handle video toggle
  const handleToggleVideo = useCallback(() => {
    toggleVideo();
  }, [toggleVideo]);

  // Handle leave room
  const handleLeaveRoom = useCallback(() => {
    // Redirect to home page
    setLocation("/");
  }, [setLocation]);

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
          {/* Server-side streaming notice */}
          <div className="bg-blue-100 p-2 rounded mb-4 flex items-center text-blue-800 text-sm">
            <span className="material-icons text-blue-600 mr-2">info</span>
            <p>Using server-based streaming optimized for 12+ participants (🖥️ reduced server load)</p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap justify-between items-center mb-4">
            {/* Camera selector */}
            <div className="flex items-center mb-2 sm:mb-0">
              <label className="mr-2 text-sm font-medium">
                Camera:
              </label>
              <Select
                value={selectedDeviceId ? selectedDeviceId : "no-camera"}
                onValueChange={switchCamera}
                disabled={videoDevices.length === 0}
              >
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent>
                  {videoDevices.length === 0 ? (
                    <SelectItem value="no-camera">No cameras detected</SelectItem>
                  ) : (
                    videoDevices.map(device => {
                      // Ensure the device ID is never an empty string
                      const deviceId = device.deviceId || `camera-id-${Math.random().toString(36).substr(2, 9)}`;
                      return (
                        <SelectItem key={deviceId} value={deviceId}>
                          {device.label || `Camera ${deviceId.slice(0, 5)}...`}
                        </SelectItem>
                      );
                    })
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
                variant={hasVideoEnabled ? "default" : "destructive"}
                className="flex items-center" 
                onClick={handleToggleVideo}
              >
                <span className="material-icons mr-1">
                  {hasVideoEnabled ? "videocam" : "videocam_off"}
                </span>
                <span className="hidden sm:inline">{hasVideoEnabled ? "Turn Off Camera" : "Turn On Camera"}</span>
                <span className="sm:hidden">{hasVideoEnabled ? "Off" : "On"}</span>
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