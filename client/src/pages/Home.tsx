import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [location, setLocation] = useLocation();
  const [isCreating, setIsCreating] = useState(false);
  const [joinRoomToken, setJoinRoomToken] = useState("");
  const { toast } = useToast();

  const handleCreateRoom = async () => {
    try {
      setIsCreating(true);
      const response = await apiRequest("POST", "/api/rooms", {});
      const data = await response.json();
      setLocation(`/room/${data.token}`);
    } catch (error) {
      console.error("Error creating room:", error);
      toast({
        title: "Error creating room",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = () => {
    if (!joinRoomToken) {
      toast({
        title: "Missing room token",
        description: "Please enter a room token to join.",
        variant: "destructive",
      });
      return;
    }

    setLocation(`/room/${joinRoomToken}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Mafia Game with Webcams</CardTitle>
          <CardDescription>
            Connect with up to 12 participants via webcam for your Mafia game
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Button 
              className="w-full" 
              onClick={handleCreateRoom}
              disabled={isCreating}
            >
              {isCreating ? "Creating..." : "Create New Room"}
            </Button>
          </div>

          <div className="flex items-center">
            <div className="h-px flex-1 bg-muted"></div>
            <span className="px-3 text-sm text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-muted"></div>
          </div>

          <div className="space-y-3">
            <Label htmlFor="room-token">Join Existing Room</Label>
            <div className="flex space-x-2">
              <Input 
                id="room-token" 
                placeholder="Enter room token" 
                value={joinRoomToken}
                onChange={(e) => setJoinRoomToken(e.target.value)}
              />
              <Button onClick={handleJoinRoom}>Join</Button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-center text-sm text-muted-foreground">
          No login required — just enter a nickname when you join!
        </CardFooter>
      </Card>
    </div>
  );
}
