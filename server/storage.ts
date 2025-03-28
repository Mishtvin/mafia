import { 
  Room, InsertRoom, 
  Participant, InsertParticipant,
  participants, rooms 
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Room operations
  createRoom(insertRoom?: InsertRoom): Promise<Room>;
  getRoom(token: string): Promise<Room | undefined>;
  
  // Participant operations
  addParticipant(participant: InsertParticipant): Promise<Participant>;
  getParticipant(roomId: number, userId: string): Promise<Participant | undefined>;
  getParticipantsByRoom(roomId: number): Promise<Participant[]>;
  updateParticipantPosition(id: number, position: number): Promise<Participant>;
  updateParticipantVideo(id: number, hasVideo: boolean): Promise<Participant>;
  removeParticipant(roomId: number, userId: string): Promise<boolean>;
  
  // Position updates
  swapPositions(roomId: number, userId1: string, userId2: string): Promise<boolean>;
  moveParticipant(roomId: number, userId: string, position: number): Promise<boolean>;
  updatePositions(roomId: number, positionUpdates: {userId: string, position: number}[]): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private rooms: Map<number, Room>;
  private participants: Map<number, Participant>;
  private roomIdByToken: Map<string, number>;
  
  private roomIdCounter: number;
  private participantIdCounter: number;
  
  constructor() {
    this.rooms = new Map();
    this.participants = new Map();
    this.roomIdByToken = new Map();
    
    this.roomIdCounter = 1;
    this.participantIdCounter = 1;
  }
  
  async createRoom(insertRoom?: InsertRoom): Promise<Room> {
    const id = this.roomIdCounter++;
    const token = insertRoom?.token || this.generateRoomToken();
    const createdAt = Math.floor(Date.now() / 1000);
    
    const room: Room = { id, token, createdAt };
    this.rooms.set(id, room);
    this.roomIdByToken.set(token, id);
    
    return room;
  }
  
  async getRoom(token: string): Promise<Room | undefined> {
    const roomId = this.roomIdByToken.get(token);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }
  
  async addParticipant(participant: InsertParticipant): Promise<Participant> {
    const id = this.participantIdCounter++;
    const newParticipant: Participant = { 
      ...participant, 
      id,
      hasVideo: participant.hasVideo ?? true // Ensure hasVideo is always a boolean
    };
    
    this.participants.set(id, newParticipant);
    return newParticipant;
  }
  
  async getParticipant(roomId: number, userId: string): Promise<Participant | undefined> {
    const allParticipants = Array.from(this.participants.values());
    return allParticipants.find(p => p.roomId === roomId && p.userId === userId);
  }
  
  async getParticipantsByRoom(roomId: number): Promise<Participant[]> {
    const allParticipants = Array.from(this.participants.values());
    return allParticipants.filter(p => p.roomId === roomId);
  }
  
  async updateParticipantPosition(id: number, position: number): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant) {
      throw new Error(`Participant with ID ${id} not found`);
    }
    
    const updated = { ...participant, position };
    this.participants.set(id, updated);
    return updated;
  }
  
  async updateParticipantVideo(id: number, hasVideo: boolean): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant) {
      throw new Error(`Participant with ID ${id} not found`);
    }
    
    const updated = { ...participant, hasVideo };
    this.participants.set(id, updated);
    return updated;
  }
  
  async removeParticipant(roomId: number, userId: string): Promise<boolean> {
    const participant = await this.getParticipant(roomId, userId);
    if (!participant) return false;
    
    this.participants.delete(participant.id);
    return true;
  }
  
  async swapPositions(roomId: number, userId1: string, userId2: string): Promise<boolean> {
    const p1 = await this.getParticipant(roomId, userId1);
    const p2 = await this.getParticipant(roomId, userId2);
    
    if (!p1 || !p2) return false;
    
    // Swap positions
    const p1Pos = p1.position;
    
    const updated1 = { ...p1, position: p2.position };
    const updated2 = { ...p2, position: p1Pos };
    
    this.participants.set(p1.id, updated1);
    this.participants.set(p2.id, updated2);
    
    return true;
  }
  
  async moveParticipant(roomId: number, userId: string, position: number): Promise<boolean> {
    const participant = await this.getParticipant(roomId, userId);
    if (!participant) return false;
    
    // Update position
    const updated = { ...participant, position };
    this.participants.set(participant.id, updated);
    
    return true;
  }
  
  async updatePositions(roomId: number, positionUpdates: {userId: string, position: number}[]): Promise<boolean> {
    // Get all participants in the room
    const roomParticipants = await this.getParticipantsByRoom(roomId);
    
    // Create a map of userId to participant for faster lookup
    const participantMap = new Map<string, Participant>();
    for (const p of roomParticipants) {
      participantMap.set(p.userId, p);
    }
    
    // Apply position updates
    for (const update of positionUpdates) {
      const participant = participantMap.get(update.userId);
      if (participant) {
        const updated = { ...participant, position: update.position };
        this.participants.set(participant.id, updated);
      }
    }
    
    return true;
  }
  
  // Helper method to generate a unique room token
  private generateRoomToken(): string {
    return randomUUID().substring(0, 8);
  }
}

export const storage = new MemStorage();
