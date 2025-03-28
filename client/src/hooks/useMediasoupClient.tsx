import { useState, useEffect, useCallback, useRef } from 'react';
import { Device } from 'mediasoup-client';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

interface MediasoupClientState {
  device: Device | null;
  connected: boolean;
  producerTransport: any | null;
  consumerTransports: Map<string, any>;
  producer: any | null;
  consumers: Map<string, any>;
  isProducing: boolean;
  error: string | null;
}

interface Participant {
  id: string;
  nickname: string;
  position: number;
  hasVideo: boolean;
}

interface MediasoupResult {
  device: Device | null;
  socket: Socket | null;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  localVideo: boolean;
  participants: Participant[];
  error: string | null;
  connect: (roomToken: string, userId: string, nickname: string) => Promise<void>;
  startLocalVideo: () => Promise<void>;
  stopLocalVideo: () => void;
  updatePosition: (position: number) => void;
}

export function useMediasoupClient(): MediasoupResult {
  const [state, setState] = useState<MediasoupClientState>({
    device: null,
    connected: false,
    producerTransport: null,
    consumerTransports: new Map(),
    producer: null,
    consumers: new Map(),
    isProducing: false,
    error: null,
  });
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [localVideo, setLocalVideo] = useState<boolean>(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  
  const socketRef = useRef<Socket | null>(null);
  const roomTokenRef = useRef<string>('');
  const userIdRef = useRef<string>('');
  
  // Initialize device
  useEffect(() => {
    try {
      const device = new Device();
      setState(prev => ({ ...prev, device }));
    } catch (error) {
      console.error('Error creating mediasoup device:', error);
      setState(prev => ({ ...prev, error: 'Failed to initialize video device' }));
    }
  }, []);
  
  // Socket connection and event handlers
  const connect = useCallback(async (roomToken: string, userId: string, nickname: string) => {
    try {
      // If socket already exists, disconnect
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      
      // Create new socket connection
      const newSocket = io('/', {
        query: { roomToken, userId },
      });
      
      socketRef.current = newSocket;
      roomTokenRef.current = roomToken;
      userIdRef.current = userId;
      
      // Socket event listeners
      newSocket.on('connect', () => {
        console.log('Connected to signaling server');
        
        // Join the room
        newSocket.emit('join-room', { userId, nickname }, async (response: any) => {
          if (response.success) {
            setParticipants(response.participants);
            
            // Load device with router RTP capabilities
            newSocket.emit('get-rtp-capabilities', { userId }, async (response: any) => {
              if (response.success) {
                try {
                  await state.device?.load({ routerRtpCapabilities: response.rtpCapabilities });
                  setState(prev => ({ ...prev, connected: true }));
                  console.log('Mediasoup device loaded successfully');
                } catch (error) {
                  console.error('Failed to load device:', error);
                  setState(prev => ({ ...prev, error: 'Failed to initialize video system' }));
                }
              } else {
                console.error('Failed to get RTP capabilities:', response.error);
                setState(prev => ({ ...prev, error: 'Failed to get streaming capabilities' }));
              }
            });
          } else {
            console.error('Failed to join room:', response.error);
            setState(prev => ({ ...prev, error: 'Failed to join room' }));
          }
        });
      });
      
      // Handle connection error
      newSocket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        setState(prev => ({ ...prev, error: 'Connection error' }));
      });
      
      // Handle participant joined
      newSocket.on('participant-joined', (participant: Participant) => {
        setParticipants(prev => [...prev, participant]);
      });
      
      // Handle participant left
      newSocket.on('participant-left', ({ participantId }: { participantId: string }) => {
        setParticipants(prev => prev.filter(p => p.id !== participantId));
        
        // Close and remove consumer if exists
        const consumer = state.consumers.get(participantId);
        if (consumer) {
          consumer.close();
          setState(prev => {
            const newConsumers = new Map(prev.consumers);
            newConsumers.delete(participantId);
            return { ...prev, consumers: newConsumers };
          });
          
          // Remove remote stream
          setRemoteStreams(prev => {
            const newStreams = new Map(prev);
            newStreams.delete(participantId);
            return newStreams;
          });
        }
      });
      
      // Handle video status changed
      newSocket.on('video-status-changed', ({ participantId, hasVideo }: { participantId: string, hasVideo: boolean }) => {
        setParticipants(prev => 
          prev.map(p => p.id === participantId ? { ...p, hasVideo } : p)
        );
      });
      
      // Handle positions updated
      newSocket.on('positions-updated', (updatedParticipants: Participant[]) => {
        setParticipants(updatedParticipants);
      });
      
    } catch (error) {
      console.error('Error connecting to signaling server:', error);
      setState(prev => ({ ...prev, error: 'Failed to connect to server' }));
    }
  }, [state.device]);
  
  // Start local video
  const startLocalVideo = useCallback(async () => {
    if (!state.device || !state.device.loaded || !socketRef.current || !userIdRef.current) {
      console.error('Cannot start video: device not loaded or not connected');
      return;
    }
    
    try {
      // Get local media stream
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setLocalStream(stream);
      setLocalVideo(true);
      
      // Create send transport if needed
      if (!state.producerTransport) {
        socketRef.current.emit('create-transport', { 
          userId: userIdRef.current, 
          direction: 'send' 
        }, async (response: any) => {
          if (!response.success) {
            console.error('Error creating send transport:', response.error);
            return;
          }
          
          const transport = state.device?.createSendTransport(response.transport);
          
          if (!transport) {
            console.error('Failed to create send transport');
            return;
          }
          
          // Set up transport events
          transport.on('connect', ({ dtlsParameters }: any, callback: Function) => {
            if (socketRef.current) {
              socketRef.current.emit('connect-transport', {
                userId: userIdRef.current,
                transportId: transport.id,
                direction: 'send',
                dtlsParameters
              }, (response: any) => {
                if (response.success) {
                  callback();
                } else {
                  console.error('Failed to connect send transport:', response.error);
                }
              });
            } else {
              console.error('Socket not connected');
            }
          });
          
          transport.on('produce', async ({ kind, rtpParameters }: any, callback: Function) => {
            if (socketRef.current) {
              socketRef.current.emit('produce', {
                userId: userIdRef.current,
                transportId: transport.id,
                kind,
                rtpParameters
              }, (response: any) => {
                if (response.success) {
                  callback({ id: response.producerId });
                } else {
                  console.error('Failed to produce:', response.error);
                }
              });
            } else {
              console.error('Socket not connected');
            }
          });
          
          setState(prev => ({ ...prev, producerTransport: transport }));
          
          // Get video track and create producer
          const track = stream.getVideoTracks()[0];
          const producer = await transport.produce({ track });
          
          setState(prev => ({ 
            ...prev, 
            producer, 
            isProducing: true 
          }));
          
          console.log('Local video producer created successfully');
        });
      } else if (state.producerTransport && !state.isProducing) {
        // Reuse existing transport
        const track = stream.getVideoTracks()[0];
        const producer = await state.producerTransport.produce({ track });
        
        setState(prev => ({ 
          ...prev, 
          producer, 
          isProducing: true 
        }));
        
        console.log('Local video producer created with existing transport');
      }
    } catch (error) {
      console.error('Error starting local video:', error);
      setState(prev => ({ ...prev, error: 'Failed to access camera' }));
    }
  }, [state.device, state.producerTransport, state.isProducing]);
  
  // Stop local video
  const stopLocalVideo = useCallback(() => {
    // Close producer if it exists
    if (state.producer) {
      state.producer.close();
      setState(prev => ({ ...prev, producer: null, isProducing: false }));
    }
    
    // Stop all tracks and clear local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    setLocalVideo(false);
    
    // Update server about video status
    if (socketRef.current && userIdRef.current) {
      socketRef.current.emit('video-status-changed', {
        userId: userIdRef.current,
        hasVideo: false
      });
    }
  }, [state.producer, localStream]);
  
  // Update position
  const updatePosition = useCallback((position: number) => {
    if (socketRef.current && userIdRef.current && roomTokenRef.current) {
      socketRef.current.emit('update-position', {
        userId: userIdRef.current,
        position
      }, (response: any) => {
        if (!response.success) {
          console.error('Failed to update position:', response.error);
        }
      });
    }
  }, []);
  
  // Consume remote streams when new participants join with video
  useEffect(() => {
    const consumeStreams = async () => {
      if (!state.device || !state.device.loaded || !socketRef.current || !userIdRef.current || !roomTokenRef.current) {
        return;
      }
      
      // Check for participants with video that we're not consuming yet
      const participantsToConsume = participants.filter(p => 
        p.hasVideo && 
        p.id !== userIdRef.current && 
        !state.consumers.has(p.id)
      );
      
      for (const participant of participantsToConsume) {
        // Create receive transport if needed for this participant
        if (!state.consumerTransports.has(participant.id)) {
          socketRef.current.emit('create-transport', {
            userId: userIdRef.current,
            direction: 'receive'
          }, async (response: any) => {
            if (!response.success) {
              console.error('Error creating receive transport:', response.error);
              return;
            }
            
            const transport = state.device?.createRecvTransport(response.transport);
            
            if (!transport) {
              console.error('Failed to create receive transport');
              return;
            }
            
            // Set up transport events
            transport.on('connect', ({ dtlsParameters }: any, callback: Function) => {
              if (socketRef.current) {
                socketRef.current.emit('connect-transport', {
                  userId: userIdRef.current,
                  transportId: transport.id,
                  direction: 'receive',
                  dtlsParameters
                }, (response: any) => {
                  if (response.success) {
                    callback();
                  } else {
                    console.error('Failed to connect receive transport:', response.error);
                  }
                });
              } else {
                console.error('Socket not connected');
              }
            });
            
            // Store transport
            setState(prev => {
              const newTransports = new Map(prev.consumerTransports);
              newTransports.set(participant.id, transport);
              return { ...prev, consumerTransports: newTransports };
            });
            
            // Create consumer
            if (socketRef.current) {
              socketRef.current.emit('consume', {
                userId: userIdRef.current,
                producerParticipantId: participant.id,
                rtpCapabilities: state.device?.rtpCapabilities
              }, async (response: any) => {
                if (!response.success) {
                  console.error('Error consuming:', response.error);
                  return;
                }
                
                try {
                  const consumer = await transport.consume({
                    id: response.consumer.id,
                    producerId: response.consumer.producerId,
                    kind: response.consumer.kind,
                    rtpParameters: response.consumer.rtpParameters
                  });
                  
                  // Store consumer
                  setState(prev => {
                    const newConsumers = new Map(prev.consumers);
                    newConsumers.set(participant.id, consumer);
                    return { ...prev, consumers: newConsumers };
                  });
                  
                  // Create stream and add track
                  const stream = new MediaStream([consumer.track]);
                  
                  // Add to remote streams
                  setRemoteStreams(prev => {
                    const newStreams = new Map(prev);
                    newStreams.set(participant.id, stream);
                    return newStreams;
                  });
                  
                  console.log(`Consuming ${participant.id}'s stream`);
                } catch (error) {
                  console.error('Error consuming stream:', error);
                }
              });
            }
          });
        }
      }
    };
    
    consumeStreams();
  }, [state.device, participants, state.consumers, state.consumerTransports]);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Close and clean up all transports and consumers
      if (state.producerTransport) {
        state.producerTransport.close();
      }
      
      state.consumerTransports.forEach(transport => {
        transport.close();
      });
      
      state.consumers.forEach(consumer => {
        consumer.close();
      });
      
      // Stop local stream
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      
      // Disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [state.producerTransport, state.consumerTransports, state.consumers, localStream]);
  
  return {
    device: state.device,
    socket: socketRef.current,
    localStream,
    remoteStreams,
    localVideo,
    participants,
    error: state.error,
    connect,
    startLocalVideo,
    stopLocalVideo,
    updatePosition
  };
}