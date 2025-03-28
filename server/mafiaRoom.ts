// Using mediasoup types
import { types } from 'mediasoup';
import { getRouter, createWebRtcTransport } from './mediasoupServer';
import { createLogger } from './logger';

const roomLogger = createLogger('mafiaRoom');

// Maximum number of participants allowed in the room
const MAX_PARTICIPANTS = 12;

// Interface for a participant
interface Participant {
  id: string;
  nickname: string;
  position: number; // Position in the grid (0-based index)
  producerTransport?: types.WebRtcTransport;
  consumerTransport?: types.WebRtcTransport;
  producer?: types.Producer;
  consumers: Map<string, types.Consumer>;
  hasVideo: boolean;
}

/**
 * MafiaRoom class - Singleton room for all participants
 */
class MafiaRoom {
  // Map of participants indexed by their ID
  private participants: Map<string, Participant> = new Map();
  
  // Room name is fixed
  private readonly roomName = 'mafia';
  
  constructor() {
    roomLogger.log(`Created MafiaRoom: ${this.roomName}`);
  }

  /**
   * Get the room name
   */
  getRoomName(): string {
    return this.roomName;
  }

  /**
   * Get all participants in the room
   */
  getParticipants(): Map<string, Participant> {
    return this.participants;
  }

  /**
   * Get participant info suitable for sending to clients
   */
  getParticipantsInfo(): Array<{
    id: string;
    nickname: string;
    position: number;
    hasVideo: boolean;
  }> {
    return Array.from(this.participants.values()).map(participant => ({
      id: participant.id,
      nickname: participant.nickname,
      position: participant.position,
      hasVideo: participant.hasVideo
    }));
  }

  /**
   * Add a new participant to the room
   * If the participant already exists, update their nickname
   */
  async addParticipant(id: string, nickname: string): Promise<Participant> {
    if (this.participants.size >= MAX_PARTICIPANTS && !this.participants.has(id)) {
      throw new Error('Room is full');
    }

    // Check if participant already exists
    if (this.participants.has(id)) {
      // Update nickname if needed
      const existingParticipant = this.participants.get(id)!;
      if (existingParticipant.nickname !== nickname) {
        existingParticipant.nickname = nickname;
        roomLogger.log(`Updated participant nickname: ${id}, new nickname: ${nickname}`);
      } else {
        roomLogger.log(`Participant reconnected: ${id}, nickname: ${nickname}`);
      }
      
      // Close any existing transports to avoid conflicts
      if (existingParticipant.producerTransport) {
        try {
          await existingParticipant.producerTransport.close();
          existingParticipant.producerTransport = undefined;
        } catch (error) {
          roomLogger.error(`Error closing existing producer transport for ${id}`, error);
        }
      }
      
      if (existingParticipant.consumerTransport) {
        try {
          await existingParticipant.consumerTransport.close();
          existingParticipant.consumerTransport = undefined;
        } catch (error) {
          roomLogger.error(`Error closing existing consumer transport for ${id}`, error);
        }
      }
      
      // Reset video status
      existingParticipant.hasVideo = false;
      existingParticipant.producer = undefined;
      existingParticipant.consumers = new Map();
      
      return existingParticipant;
    }

    // Find the next available position
    const usedPositions = new Set(
      Array.from(this.participants.values()).map(p => p.position)
    );
    
    let position = 0;
    while (usedPositions.has(position) && position < MAX_PARTICIPANTS) {
      position++;
    }

    const participant: Participant = {
      id,
      nickname,
      position,
      consumers: new Map(),
      hasVideo: false
    };

    this.participants.set(id, participant);
    roomLogger.log(`Added participant: ${id}, nickname: ${nickname}, position: ${position}`);
    
    return participant;
  }

  /**
   * Remove a participant from the room
   */
  async removeParticipant(id: string): Promise<void> {
    const participant = this.participants.get(id);
    
    if (!participant) {
      roomLogger.log(`Cannot remove participant: ${id} - not found`);
      return;
    }

    // Close all transports
    if (participant.producerTransport) {
      try {
        await participant.producerTransport.close();
      } catch (error) {
        roomLogger.error(`Error closing producer transport for ${id}`, error);
      }
    }

    if (participant.consumerTransport) {
      try {
        await participant.consumerTransport.close();
      } catch (error) {
        roomLogger.error(`Error closing consumer transport for ${id}`, error);
      }
    }

    this.participants.delete(id);
    roomLogger.log(`Removed participant: ${id}`);
  }

  /**
   * Update participant's position in the grid
   */
  updateParticipantPosition(id: string, position: number): boolean {
    const participant = this.participants.get(id);
    
    if (!participant) {
      roomLogger.log(`Cannot update position: participant ${id} not found`);
      return false;
    }

    // Check if position is already taken
    for (const [pid, p] of Array.from(this.participants.entries())) {
      if (pid !== id && p.position === position) {
        // Swap positions
        p.position = participant.position;
        break;
      }
    }

    participant.position = position;
    roomLogger.log(`Updated position for ${id} to ${position}`);
    return true;
  }

  /**
   * Update participant's video status
   */
  updateParticipantVideo(id: string, hasVideo: boolean): boolean {
    const participant = this.participants.get(id);
    
    if (!participant) {
      roomLogger.log(`Cannot update video status: participant ${id} not found`);
      return false;
    }

    participant.hasVideo = hasVideo;
    roomLogger.log(`Updated video status for ${id} to ${hasVideo}`);
    return true;
  }

  /**
   * Create a producer transport for a participant
   */
  async createProducerTransport(participantId: string): Promise<{
    id: string;
    iceParameters: types.IceParameters;
    iceCandidates: types.IceCandidate[];
    dtlsParameters: types.DtlsParameters;
  }> {
    const participant = this.participants.get(participantId);
    
    if (!participant) {
      throw new Error(`Participant ${participantId} not found`);
    }

    const transport = await createWebRtcTransport();
    participant.producerTransport = transport;

    // Set transport events
    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        roomLogger.log(`Producer transport closed for participant ${participantId}`);
      }
    });

    // Use observer for close events
    transport.observer.once('close', () => {
      roomLogger.log(`Producer transport closed for participant ${participantId}`);
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    };
  }

  /**
   * Create a consumer transport for a participant
   */
  async createConsumerTransport(participantId: string): Promise<{
    id: string;
    iceParameters: types.IceParameters;
    iceCandidates: types.IceCandidate[];
    dtlsParameters: types.DtlsParameters;
  }> {
    const participant = this.participants.get(participantId);
    
    if (!participant) {
      throw new Error(`Participant ${participantId} not found`);
    }

    const transport = await createWebRtcTransport();
    participant.consumerTransport = transport;

    // Set transport events
    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        roomLogger.log(`Consumer transport closed for participant ${participantId}`);
      }
    });

    // Use observer for close events
    transport.observer.once('close', () => {
      roomLogger.log(`Consumer transport closed for participant ${participantId}`);
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    };
  }

  /**
   * Connect a producer transport
   */
  async connectProducerTransport(
    participantId: string,
    dtlsParameters: types.DtlsParameters
  ): Promise<void> {
    const participant = this.participants.get(participantId);
    
    if (!participant || !participant.producerTransport) {
      throw new Error('Participant or producer transport not found');
    }

    await participant.producerTransport.connect({ dtlsParameters });
    roomLogger.log(`Producer transport connected for participant ${participantId}`);
  }

  /**
   * Connect a consumer transport
   */
  async connectConsumerTransport(
    participantId: string,
    dtlsParameters: types.DtlsParameters
  ): Promise<void> {
    const participant = this.participants.get(participantId);
    
    if (!participant || !participant.consumerTransport) {
      throw new Error('Participant or consumer transport not found');
    }

    await participant.consumerTransport.connect({ dtlsParameters });
    roomLogger.log(`Consumer transport connected for participant ${participantId}`);
  }

  /**
   * Create a producer for a participant
   */
  async createProducer(
    participantId: string,
    kind: 'video',
    rtpParameters: types.RtpParameters
  ): Promise<string> {
    const participant = this.participants.get(participantId);
    
    if (!participant || !participant.producerTransport) {
      throw new Error('Participant or producer transport not found');
    }

    const producer = await participant.producerTransport.produce({
      kind,
      rtpParameters
    });

    participant.producer = producer;
    participant.hasVideo = true;

    // Inform all existing participants about the new producer
    for (const [id, p] of Array.from(this.participants.entries())) {
      // Skip the producer itself
      if (id === participantId || !p.consumerTransport) {
        continue;
      }

      this.createConsumer(id, participantId);
    }

    roomLogger.log(`Producer created for participant ${participantId}`);
    return producer.id;
  }

  /**
   * Create a consumer for a participant to consume another's producer
   */
  async createConsumer(
    consumerId: string,
    producerId: string
  ): Promise<{
    id: string;
    producerId: string;
    kind: string;
    rtpParameters: types.RtpParameters;
    producerPausedOnCreation: boolean;
  } | null> {
    const consumer = this.participants.get(consumerId);
    const producer = this.participants.get(producerId);
    
    if (!consumer || !producer || !consumer.consumerTransport || !producer.producer) {
      roomLogger.log(`Cannot create consumer: consumer or producer not properly set up`);
      return null;
    }

    // Make sure the consumer can consume the producer
    try {
      const router = getRouter();
      
      // Create the consumer
      const consumerInstance = await consumer.consumerTransport.consume({
        producerId: producer.producer.id,
        rtpCapabilities: router.rtpCapabilities,
        paused: true // Start in paused state for bandwidth efficiency
      });

      // Store the consumer
      consumer.consumers.set(producerId, consumerInstance);

      // Resume the consumer
      await consumerInstance.resume();

      roomLogger.log(`Consumer created for ${consumerId} consuming ${producerId}`);

      return {
        id: consumerInstance.id,
        producerId: producer.producer.id,
        kind: consumerInstance.kind,
        rtpParameters: consumerInstance.rtpParameters,
        producerPausedOnCreation: producer.producer.paused
      };
    } catch (error) {
      roomLogger.log(`Error creating consumer: ${error}`);
      return null;
    }
  }

  /**
   * Create consumers for a new participant to consume all existing producers
   */
  async createConsumersForNewParticipant(
    participantId: string,
    rtpCapabilities: types.RtpCapabilities
  ): Promise<Array<{
    id: string;
    producerId: string;
    producerParticipantId: string;
    kind: string;
    rtpParameters: types.RtpParameters;
  }>> {
    const consumers: Array<{
      id: string;
      producerId: string;
      producerParticipantId: string;
      kind: string;
      rtpParameters: types.RtpParameters;
    }> = [];

    const participant = this.participants.get(participantId);
    if (!participant || !participant.consumerTransport) {
      roomLogger.log(`Cannot create consumers: participant ${participantId} not set up properly`);
      return consumers;
    }

    // Check if the router can consume
    const router = getRouter();
    if (!router.canConsume) {
      roomLogger.log(`Router cannot consume with the given RTP capabilities`);
      return consumers;
    }

    // Create a consumer for each producer
    for (const [id, p] of Array.from(this.participants.entries())) {
      if (id === participantId || !p.producer) {
        continue;
      }

      try {
        const consumer = await participant.consumerTransport.consume({
          producerId: p.producer.id,
          rtpCapabilities,
          paused: false
        });

        // Store the consumer
        participant.consumers.set(id, consumer);

        consumers.push({
          id: consumer.id,
          producerId: p.producer.id,
          producerParticipantId: id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        });

        roomLogger.log(`Created consumer for new participant ${participantId} consuming ${id}`);
      } catch (error) {
        roomLogger.log(`Error creating consumer for new participant: ${error}`);
      }
    }

    return consumers;
  }

  /**
   * Update positions of multiple participants
   */
  updatePositions(positionUpdates: { id: string, position: number }[]): boolean {
    for (const update of positionUpdates) {
      const participant = this.participants.get(update.id);
      if (participant) {
        participant.position = update.position;
      }
    }
    roomLogger.log(`Updated positions for ${positionUpdates.length} participants`);
    return true;
  }
}

// Create a singleton instance
export const mafiaRoom = new MafiaRoom();