import { pgTable, text, serial, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Room table schema
export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at").notNull(), // Unix timestamp
});

// Participant table schema
export const participants = pgTable("participants", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(), // References rooms.id
  userId: text("user_id").notNull(), // WebRTC client ID
  nickname: text("nickname").notNull(),
  position: integer("position").notNull(), // Position in the grid (0-11)
  hasVideo: boolean("has_video").notNull().default(true),
  joinedAt: integer("joined_at").notNull(), // Unix timestamp
});

// Position update schema for WebSocket messages
export const positionUpdateSchema = z.object({
  type: z.literal("positionUpdate"),
  roomToken: z.string(),
  positions: z.array(
    z.object({
      userId: z.string(),
      position: z.number().min(0).max(11),
    })
  ),
});

// Room schemas for data validation
export const insertRoomSchema = createInsertSchema(rooms).omit({ id: true });
export const insertParticipantSchema = createInsertSchema(participants).omit({ id: true });

// WebSocket message schemas
export const joinRoomMessageSchema = z.object({
  type: z.literal("joinRoom"),
  roomToken: z.string(),
  nickname: z.string().min(1).max(30),
  userId: z.string(),
});

export const leaveRoomMessageSchema = z.object({
  type: z.literal("leaveRoom"),
  roomToken: z.string(),
  userId: z.string(),
});

export const videoStatusMessageSchema = z.object({
  type: z.literal("videoStatus"),
  roomToken: z.string(),
  userId: z.string(),
  hasVideo: z.boolean(),
});

// Request validation schemas
export const createRoomRequestSchema = z.object({
  token: z.string().optional(), // Optional custom token
});

export const joinRoomRequestSchema = z.object({
  nickname: z.string().min(1).max(30),
});

// Socket message types
export type JoinRoomMessage = z.infer<typeof joinRoomMessageSchema>;
export type LeaveRoomMessage = z.infer<typeof leaveRoomMessageSchema>;
export type VideoStatusMessage = z.infer<typeof videoStatusMessageSchema>;
export type PositionUpdateMessage = z.infer<typeof positionUpdateSchema>;

// Types for database interactions
export type Room = typeof rooms.$inferSelect;
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Participant = typeof participants.$inferSelect;
export type InsertParticipant = z.infer<typeof insertParticipantSchema>;

// Client-side room state
export type RoomState = {
  token: string;
  participants: ParticipantState[];
};

export type ParticipantState = {
  userId: string;
  nickname: string;
  position: number;
  hasVideo: boolean;
  stream?: MediaStream;
  // New fields for server-side streaming
  videoWidth?: number;
  videoHeight?: number;
  frameRate?: number;
  // Optional room token for socket.io connectivity
  roomToken?: string;
};

// Video stream related types
export const videoStreamMetadataSchema = z.object({
  userId: z.string(),
  width: z.number(),
  height: z.number(),
  frameRate: z.number(),
  codecParams: z.record(z.string(), z.any()).optional()
});

export type VideoStreamMetadata = z.infer<typeof videoStreamMetadataSchema>;
