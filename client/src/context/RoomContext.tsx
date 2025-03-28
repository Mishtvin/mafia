import React, { createContext, useContext, useState, useMemo } from "react";
import { RoomState, ParticipantState } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";

interface RoomContextProps {
  roomState: RoomState | null;
  setRoomState: React.Dispatch<React.SetStateAction<RoomState | null>>;
  userId: string;
  nickname: string;
  setNickname: React.Dispatch<React.SetStateAction<string>>;
  isRearranging: boolean;
  setIsRearranging: React.Dispatch<React.SetStateAction<boolean>>;
}

const RoomContext = createContext<RoomContextProps | undefined>(undefined);

export function RoomProvider({ children }: { children: React.ReactNode }) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [nickname, setNickname] = useState<string>("");
  const [isRearranging, setIsRearranging] = useState<boolean>(false);
  
  // Generate a unique user ID for this session (test 3)
  const userId = useMemo(() => {
    // Check if we already have a userId in sessionStorage
    const existingUserId = sessionStorage.getItem("userId");
    if (existingUserId) {
      return existingUserId;
    }
    
    // Generate a new userId and store it
    const newUserId = uuidv4();
    sessionStorage.setItem("userId", newUserId);
    return newUserId;
  }, []);
  
  const value = {
    roomState,
    setRoomState,
    userId,
    nickname,
    setNickname,
    isRearranging,
    setIsRearranging,
  };
  
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoomContext() {
  const context = useContext(RoomContext);
  if (context === undefined) {
    throw new Error("useRoomContext must be used within a RoomProvider");
  }
  return context;
}
