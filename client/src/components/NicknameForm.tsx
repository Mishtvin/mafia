import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface NicknameFormProps {
  onSubmit: (nickname: string) => void;
}

export function NicknameForm({ onSubmit }: NicknameFormProps) {
  const [nickname, setNickname] = useState("");
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!nickname.trim()) {
      toast({
        title: "Nickname required",
        description: "Please enter a nickname to join the room.",
        variant: "destructive",
      });
      return;
    }
    
    onSubmit(nickname.trim());
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md animate-in fade-in-0 zoom-in-95 duration-300">
        <CardHeader>
          <CardTitle className="text-xl">Enter Your Nickname</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nickname">Nickname</Label>
              <Input
                id="nickname"
                placeholder="Enter a nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                autoFocus
                maxLength={30}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit">
                Join Room
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
