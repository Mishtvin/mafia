import { useState, useEffect, useCallback, useRef } from 'react';
import { Device } from 'mediasoup-client';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

// Debug logger
const debug = (context: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  const fullMessage = `[${timestamp}] [MediasoupClient:${context}] ${message}`;
  
  if (data) {
    console.log(fullMessage, data);
  } else {
    console.log(fullMessage);
  }
};

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
  const nicknameRef = useRef<string>('');
  
  // Initialize device
  useEffect(() => {
    try {
      debug('init', 'Creating new MediaSoup device');
      const device = new Device();
      setState(prev => ({ ...prev, device }));
      debug('init', 'MediaSoup device created successfully');
    } catch (error) {
      debug('init', 'Error creating mediasoup device', error);
      setState(prev => ({ ...prev, error: 'Failed to initialize video device' }));
    }
  }, []);
  
  // Socket connection and event handlers
  const connect = useCallback(async (roomToken: string, userId: string, nickname: string) => {
    try {
      debug('connect', `Connecting to room ${roomToken} with userId ${userId} and nickname ${nickname}`);
      
      // If socket already exists, disconnect
      if (socketRef.current) {
        debug('connect', 'Disconnecting existing socket connection');
        socketRef.current.disconnect();
      }
      
      // Create new socket connection
      debug('connect', 'Creating new Socket.IO connection');
      const newSocket = io('/', {
        query: { roomToken, userId },
      });
      
      socketRef.current = newSocket;
      roomTokenRef.current = roomToken;
      userIdRef.current = userId;
      nicknameRef.current = nickname;
      debug('connect', 'Socket reference updated, waiting for connect event');
      
      // Socket event listeners
      newSocket.on('connect', () => {
        debug('socket', 'Connected to signaling server');
        
        // Join the room
        setTimeout(() => {
          debug('socket', `Joining room with userId: ${userId}, nickname: ${nickname}`);
          
          // First join room via socket.io
          newSocket.emit('joinRoom', { roomToken, userId, nickname }, () => {
            debug('socket', `Joined room via Socket.IO: ${roomToken}`);
            
            // Then use the mediasoup signaling
            debug('socket', 'Sending join-room request via mediasoup signaling');
            newSocket.emit('join-room', { userId, nickname }, async (response: any) => {
              debug('socket', 'Received join-room response', response);
              
              if (response && response.success) {
                debug('socket', `Setting ${response.participants?.length || 0} participants`);
                setParticipants(response.participants || []);
                
                // Load device with router RTP capabilities
                debug('socket', 'Requesting RTP capabilities');
                newSocket.emit('get-rtp-capabilities', { userId }, async (response: any) => {
                  debug('socket', 'Received RTP capabilities response', response);
                  
                  if (response && response.success) {
                    try {
                      debug('device', 'Loading device with RTP capabilities', response.rtpCapabilities);
                      await state.device?.load({ routerRtpCapabilities: response.rtpCapabilities });
                      setState(prev => ({ ...prev, connected: true }));
                      debug('device', 'MediaSoup device loaded successfully');
                    } catch (error) {
                      debug('device', 'Failed to load device', error);
                      setState(prev => ({ ...prev, error: 'Failed to initialize video system' }));
                    }
                  } else {
                    debug('device', 'Failed to get RTP capabilities', response?.error || 'Unknown error');
                    setState(prev => ({ ...prev, error: 'Failed to get streaming capabilities' }));
                  }
                });
              } else {
                debug('socket', 'Failed to join room', response?.error || 'Unknown error');
                setState(prev => ({ ...prev, error: 'Failed to join room' }));
              }
            });
          });
        }, 500); // Small delay to ensure socket connection is stable
      });
      
      // Handle connection error
      newSocket.on('connect_error', (error) => {
        debug('socket', 'Connection error', error);
        setState(prev => ({ ...prev, error: 'Connection error' }));
      });
      
      // Handle participant joined
      newSocket.on('participant-joined', (participant: Participant) => {
        debug('participants', `Participant joined: ${participant.id} (${participant.nickname})`, participant);
        setParticipants(prev => [...prev, participant]);
      });
      
      // Handle participant left
      newSocket.on('participant-left', ({ participantId }: { participantId: string }) => {
        debug('participants', `Participant left: ${participantId}`);
        setParticipants(prev => prev.filter(p => p.id !== participantId));
        
        // Close and remove consumer if exists
        const consumer = state.consumers.get(participantId);
        if (consumer) {
          debug('consumer', `Closing consumer for participant: ${participantId}`);
          consumer.close();
          setState(prev => {
            const newConsumers = new Map(prev.consumers);
            newConsumers.delete(participantId);
            return { ...prev, consumers: newConsumers };
          });
          
          // Remove remote stream
          debug('stream', `Removing remote stream for participant: ${participantId}`);
          setRemoteStreams(prev => {
            const newStreams = new Map(prev);
            newStreams.delete(participantId);
            return newStreams;
          });
        }
      });
      
      // Handle video status changed
      newSocket.on('video-status-changed', ({ participantId, hasVideo }: { participantId: string, hasVideo: boolean }) => {
        debug('video', `Video status changed for ${participantId}: ${hasVideo ? 'enabled' : 'disabled'}`);
        setParticipants(prev => 
          prev.map(p => p.id === participantId ? { ...p, hasVideo } : p)
        );
      });
      
      // Handle positions updated
      newSocket.on('positions-updated', (updatedParticipants: Participant[]) => {
        debug('positions', `Positions updated for ${updatedParticipants.length} participants`);
        setParticipants(updatedParticipants);
      });
      
    } catch (error) {
      console.error('Error connecting to signaling server:', error);
      setState(prev => ({ ...prev, error: 'Failed to connect to server' }));
    }
  }, [state.device]);
  
  // Start local video with retry mechanism and better error handling
  const startLocalVideo = useCallback(async () => {
    // Check prerequisites
    if (!socketRef.current || !userIdRef.current) {
      debug('video', 'Cannot start video: socket not connected or missing userId');
      setState(prev => ({ ...prev, error: 'Connection not ready' }));
      return;
    }
    
    // Stop existing tracks if any
    if (localStream) {
      debug('video', 'Stopping existing local stream tracks');
      localStream.getTracks().forEach(track => {
        debug('video', `Stopping track: ${track.kind}, ID: ${track.id}`);
        track.stop();
      });
    }
    
    // If device not loaded, try loading it first with configurable retries
    let deviceLoadingAttempts = 0;
    const MAX_DEVICE_LOADING_ATTEMPTS = 3;
    
    const loadMediasoupDevice = async (): Promise<boolean> => {
      if (state.device?.loaded) {
        debug('device', 'MediaSoup device already loaded');
        return true;
      }
      
      if (deviceLoadingAttempts >= MAX_DEVICE_LOADING_ATTEMPTS) {
        debug('device', `Max device loading attempts (${MAX_DEVICE_LOADING_ATTEMPTS}) reached`);
        return false;
      }
      
      try {
        deviceLoadingAttempts++;
        debug('device', `Loading MediaSoup device (attempt ${deviceLoadingAttempts}/${MAX_DEVICE_LOADING_ATTEMPTS})...`);
        
        // Ensure we're registered in the room first
        if (!state.connected) {
          debug('socket', 'Re-joining room to establish connection');
          
          return new Promise<boolean>((resolve) => {
            if (!socketRef.current || !userIdRef.current || !nicknameRef.current) {
              debug('socket', 'Missing socket or user details for rejoining');
              resolve(false);
              return;
            }
            
            socketRef.current.emit('join-room', { 
              userId: userIdRef.current, 
              nickname: nicknameRef.current || `User-${userIdRef.current.substring(0, 5)}` 
            }, (joinResponse: any) => {
              debug('socket', 'Room re-join response:', joinResponse);
              
              if (!joinResponse.success) {
                debug('socket', 'Failed to re-join room');
                resolve(false);
                return;
              }
              
              // Now request RTP capabilities
              if (!socketRef.current) {
                debug('socket', 'Socket disconnected during device loading');
                resolve(false);
                return;
              }
              
              socketRef.current.emit('get-rtp-capabilities', { userId: userIdRef.current }, async (response: any) => {
                debug('device', 'RTP capabilities response:', response);
                
                if (!response?.success) {
                  debug('device', 'Failed to get RTP capabilities:', response?.error || 'Unknown error');
                  resolve(false);
                  return;
                }
                
                try {
                  if (!state.device) {
                    debug('device', 'Creating new MediaSoup device');
                    const newDevice = new Device();
                    
                    debug('device', 'Loading device with RTP capabilities');
                    await newDevice.load({ routerRtpCapabilities: response.rtpCapabilities });
                    
                    debug('device', 'Device loaded successfully, updating state');
                    setState(prev => ({ ...prev, device: newDevice, connected: true }));
                  } else {
                    debug('device', 'Loading existing MediaSoup device with RTP capabilities');
                    await state.device.load({ routerRtpCapabilities: response.rtpCapabilities });
                    debug('device', 'Existing device loaded successfully');
                    setState(prev => ({ ...prev, connected: true }));
                  }
                  
                  debug('device', 'Device loading successful');
                  resolve(true);
                } catch (error) {
                  debug('device', 'Error loading device:', error);
                  resolve(false);
                }
              });
            });
          });
        } else {
          // If already connected, just load device
          return new Promise<boolean>((resolve) => {
            if (!socketRef.current || !userIdRef.current) {
              debug('socket', 'Socket not connected for device loading');
              resolve(false);
              return;
            }
            
            socketRef.current.emit('get-rtp-capabilities', { userId: userIdRef.current }, async (response: any) => {
              debug('device', 'RTP capabilities response:', response);
              
              if (!response?.success) {
                debug('device', 'Failed to get RTP capabilities:', response?.error || 'Unknown error');
                resolve(false);
                return;
              }
              
              try {
                if (!state.device) {
                  debug('device', 'Creating new MediaSoup device');
                  const newDevice = new Device();
                  
                  debug('device', 'Loading device with RTP capabilities');
                  await newDevice.load({ routerRtpCapabilities: response.rtpCapabilities });
                  
                  debug('device', 'Device loaded successfully, updating state');
                  setState(prev => ({ ...prev, device: newDevice, connected: true }));
                } else {
                  debug('device', 'Loading existing MediaSoup device with RTP capabilities');
                  await state.device.load({ routerRtpCapabilities: response.rtpCapabilities });
                  debug('device', 'Existing device loaded successfully');
                  setState(prev => ({ ...prev, connected: true }));
                }
                
                debug('device', 'Device loading successful');
                resolve(true);
              } catch (error) {
                debug('device', 'Error loading device:', error);
                resolve(false);
              }
            });
          });
        }
      } catch (error) {
        debug('device', 'Exception during device loading:', error);
        return false;
      }
    };
    
    // Try to load the device if needed
    if (!state.device?.loaded) {
      const deviceLoaded = await loadMediasoupDevice();
      if (!deviceLoaded) {
        debug('device', 'Failed to load MediaSoup device after multiple attempts');
        setState(prev => ({ ...prev, error: 'Device initialization failed' }));
        return;
      }
    }
    
    // Now try to access the camera
    try {
      debug('video', 'Attempting to access camera...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      });
      
      debug('video', `Camera accessed successfully, stream ID: ${stream.id}`);
      
      // Log video track details for debugging
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        debug('video', 'Video track settings:', videoTrack.getSettings());
      }
      
      // Update state with new stream
      setLocalStream(stream);
      setLocalVideo(true);
      
      // Create send transport if needed
      if (!state.producerTransport) {
        debug('transport', 'Creating new send transport');
        
        if (!socketRef.current || !userIdRef.current) {
          debug('transport', 'Socket not connected for transport creation');
          setState(prev => ({ ...prev, error: 'Connection lost while setting up video' }));
          return;
        }
        
        socketRef.current.emit('create-transport', { 
          userId: userIdRef.current, 
          direction: 'send' 
        }, async (response: any) => {
          debug('transport', 'Create send transport response:', response);
          
          if (!response.success) {
            debug('transport', 'Error creating send transport:', response.error);
            setState(prev => ({ ...prev, error: `Transport creation failed: ${response.error}` }));
            return;
          }
          
          if (!state.device) {
            debug('transport', 'No device available to create transport');
            setState(prev => ({ ...prev, error: 'Device not initialized' }));
            return;
          }
          
          debug('transport', 'Creating send transport with parameters:', response.transport);
          const transport = state.device.createSendTransport(response.transport);
          
          if (!transport) {
            debug('transport', 'Failed to create send transport - device returned null');
            setState(prev => ({ ...prev, error: 'Transport creation failed' }));
            return;
          }
          
          // Set up transport events with better error handling
          transport.on('connect', ({ dtlsParameters }: any, callback: Function) => {
            debug('transport', 'Send transport connect event fired with dtlsParameters:', dtlsParameters);
            
            if (!socketRef.current || !userIdRef.current) {
              debug('transport', 'Socket disconnected during transport connection');
              setState(prev => ({ ...prev, error: 'Connection lost during setup' }));
              return;
            }
            
            debug('transport', 'Sending connect-transport request');
            socketRef.current.emit('connect-transport', {
              userId: userIdRef.current,
              transportId: transport.id,
              direction: 'send',
              dtlsParameters
            }, (response: any) => {
              debug('transport', 'Connect send transport response:', response);
              
              if (response.success) {
                debug('transport', 'Send transport connected successfully, calling callback');
                callback();
              } else {
                debug('transport', 'Failed to connect send transport:', response.error);
                setState(prev => ({ ...prev, error: `Transport connection failed: ${response.error}` }));
              }
            });
          });
          
          transport.on('produce', async ({ kind, rtpParameters }: any, callback: Function) => {
            debug('transport', `Produce event fired with kind: ${kind}`);
            debug('transport', 'RTP parameters:', rtpParameters);
            
            if (!socketRef.current || !userIdRef.current) {
              debug('transport', 'Socket disconnected during produce');
              setState(prev => ({ ...prev, error: 'Connection lost during video setup' }));
              return;
            }
            
            debug('transport', 'Sending produce request');
            socketRef.current.emit('produce', {
              userId: userIdRef.current,
              transportId: transport.id,
              kind,
              rtpParameters
            }, (response: any) => {
              debug('transport', 'Produce response:', response);
              
              if (response.success) {
                debug('transport', `Producer created with ID: ${response.producerId}`);
                callback({ id: response.producerId });
              } else {
                debug('transport', 'Failed to produce:', response.error);
                setState(prev => ({ ...prev, error: `Video production failed: ${response.error}` }));
              }
            });
          });
          
          // Store transport in state
          debug('transport', 'Storing producer transport in state');
          setState(prev => ({ ...prev, producerTransport: transport }));
          
          try {
            // Get video track and create producer
            const track = stream.getVideoTracks()[0];
            if (!track) {
              debug('producer', 'No video track available');
              setState(prev => ({ ...prev, error: 'No video track available' }));
              return;
            }
            
            debug('producer', 'Creating producer with video track');
            const producer = await transport.produce({ track });
            debug('producer', `Producer created with ID: ${producer.id}`);
            
            setState(prev => ({ 
              ...prev, 
              producer, 
              isProducing: true,
              error: null // Clear any previous errors
            }));
            
            debug('producer', 'Local video producer created successfully');
          } catch (error) {
            debug('producer', 'Error creating producer:', error);
            setState(prev => ({ ...prev, error: `Producer creation failed: ${error}` }));
          }
        });
      } else if (state.producerTransport && !state.isProducing) {
        // Reuse existing transport if available but not producing
        debug('producer', 'Reusing existing transport to create producer');
        
        try {
          const track = stream.getVideoTracks()[0];
          if (!track) {
            debug('producer', 'No video track available for existing transport');
            setState(prev => ({ ...prev, error: 'No video track available' }));
            return;
          }
          
          debug('producer', 'Creating producer with existing transport');
          const producer = await state.producerTransport.produce({ track });
          
          debug('producer', `Producer created with existing transport, ID: ${producer.id}`);
          
          setState(prev => ({ 
            ...prev, 
            producer, 
            isProducing: true,
            error: null // Clear any previous errors
          }));
          
          debug('producer', 'Local video producer created successfully with existing transport');
        } catch (error) {
          debug('producer', 'Error creating producer with existing transport:', error);
          setState(prev => ({ ...prev, error: `Producer creation failed: ${error}` }));
        }
      } else {
        debug('producer', 'Already producing video, no need to recreate producer');
      }
    } catch (error) {
      debug('video', 'Error accessing camera or starting local video:', error);
      setState(prev => ({ 
        ...prev, 
        error: `Camera access failed: ${error instanceof Error ? error.message : String(error)}` 
      }));
    }
  }, [state.device, state.producerTransport, state.isProducing, state.connected, localStream]);
  
  // Stop local video
  const stopLocalVideo = useCallback(() => {
    debug('video', 'Stopping local video');
    
    // Close producer if it exists
    if (state.producer) {
      debug('producer', `Closing producer ID: ${state.producer.id}`);
      state.producer.close();
      setState(prev => ({ ...prev, producer: null, isProducing: false }));
    }
    
    // Stop all tracks and clear local stream
    if (localStream) {
      debug('video', 'Stopping all local stream tracks');
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    debug('video', 'Setting localVideo state to false');
    setLocalVideo(false);
    
    // Update server about video status
    if (socketRef.current && userIdRef.current) {
      debug('video', 'Notifying server that video is disabled');
      socketRef.current.emit('video-status-changed', {
        userId: userIdRef.current,
        hasVideo: false
      });
    }
  }, [state.producer, localStream]);
  
  // Update position
  const updatePosition = useCallback((position: number) => {
    if (socketRef.current && userIdRef.current && roomTokenRef.current) {
      debug('position', `Updating position to ${position}`);
      socketRef.current.emit('update-position', {
        userId: userIdRef.current,
        position
      }, (response: any) => {
        if (response.success) {
          debug('position', `Position update successful`);
        } else {
          debug('position', `Failed to update position:`, response.error);
        }
      });
    } else {
      debug('position', `Cannot update position: missing socket or user ID or room token`);
    }
  }, []);
  
  // Consume remote streams when new participants join with video
  useEffect(() => {
    const consumeStreams = async () => {
      if (!state.device || !state.device.loaded || !socketRef.current || !userIdRef.current || !roomTokenRef.current) {
        debug('consumer', 'Cannot consume streams: device or connection not ready');
        return;
      }
      
      // Check for participants with video that we're not consuming yet
      const participantsToConsume = participants.filter(p => 
        p.hasVideo && 
        p.id !== userIdRef.current && 
        !state.consumers.has(p.id)
      );
      
      debug('consumer', `Found ${participantsToConsume.length} participants to consume`);
      
      for (const participant of participantsToConsume) {
        debug('consumer', `Setting up consumption for participant: ${participant.id} (${participant.nickname})`);
        
        // Create receive transport if needed for this participant
        if (!state.consumerTransports.has(participant.id)) {
          debug('transport', `Creating receive transport for participant: ${participant.id}`);
          
          socketRef.current.emit('create-transport', {
            userId: userIdRef.current,
            direction: 'receive'
          }, async (response: any) => {
            debug('transport', `Receive transport creation response:`, response);
            
            if (!response.success) {
              debug('transport', `Error creating receive transport:`, response.error);
              return;
            }
            
            debug('transport', `Creating receive transport with parameters:`, response.transport);
            const transport = state.device?.createRecvTransport(response.transport);
            
            if (!transport) {
              debug('transport', `Failed to create receive transport - device returned null`);
              return;
            }
            
            // Set up transport events
            transport.on('connect', ({ dtlsParameters }: any, callback: Function) => {
              debug('transport', `Receive transport connect event fired with dtlsParameters:`, dtlsParameters);
              
              if (socketRef.current) {
                debug('transport', `Sending connect-transport request for receive transport`);
                socketRef.current.emit('connect-transport', {
                  userId: userIdRef.current,
                  transportId: transport.id,
                  direction: 'receive',
                  dtlsParameters
                }, (response: any) => {
                  debug('transport', `Connect receive transport response:`, response);
                  
                  if (response.success) {
                    debug('transport', `Receive transport connected successfully, calling callback`);
                    callback();
                  } else {
                    debug('transport', `Failed to connect receive transport:`, response.error);
                  }
                });
              } else {
                debug('transport', `Cannot connect transport: socket not connected`);
              }
            });
            
            // Store transport
            debug('transport', `Storing receive transport for participant: ${participant.id}`);
            setState(prev => {
              const newTransports = new Map(prev.consumerTransports);
              newTransports.set(participant.id, transport);
              return { ...prev, consumerTransports: newTransports };
            });
            
            // Create consumer
            if (socketRef.current) {
              debug('consumer', `Requesting to consume participant: ${participant.id}`);
              socketRef.current.emit('consume', {
                userId: userIdRef.current,
                producerParticipantId: participant.id,
                rtpCapabilities: state.device?.rtpCapabilities
              }, async (response: any) => {
                debug('consumer', `Consume response:`, response);
                
                if (!response.success) {
                  debug('consumer', `Error consuming:`, response.error);
                  return;
                }
                
                try {
                  debug('consumer', `Creating consumer with parameters:`, response.consumer);
                  const consumer = await transport.consume({
                    id: response.consumer.id,
                    producerId: response.consumer.producerId,
                    kind: response.consumer.kind,
                    rtpParameters: response.consumer.rtpParameters
                  });
                  
                  debug('consumer', `Consumer created with ID: ${consumer.id}`);
                  
                  // Store consumer
                  debug('consumer', `Storing consumer for participant: ${participant.id}`);
                  setState(prev => {
                    const newConsumers = new Map(prev.consumers);
                    newConsumers.set(participant.id, consumer);
                    return { ...prev, consumers: newConsumers };
                  });
                  
                  // Create stream and add track
                  debug('stream', `Creating MediaStream from consumer track`);
                  const stream = new MediaStream([consumer.track]);
                  
                  // Add to remote streams
                  debug('stream', `Storing remote stream for participant: ${participant.id}`);
                  setRemoteStreams(prev => {
                    const newStreams = new Map(prev);
                    newStreams.set(participant.id, stream);
                    return newStreams;
                  });
                  
                  debug('consumer', `Successfully consuming ${participant.id}'s stream`);
                } catch (error) {
                  debug('consumer', `Error consuming stream:`, error);
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
      debug('cleanup', 'Running cleanup on unmount');
      
      // Close and clean up all transports and consumers
      if (state.producerTransport) {
        debug('cleanup', 'Closing producer transport');
        state.producerTransport.close();
      }
      
      debug('cleanup', `Closing ${state.consumerTransports.size} consumer transports`);
      state.consumerTransports.forEach((transport, participantId) => {
        debug('cleanup', `Closing consumer transport for participant: ${participantId}`);
        transport.close();
      });
      
      debug('cleanup', `Closing ${state.consumers.size} consumers`);
      state.consumers.forEach((consumer, participantId) => {
        debug('cleanup', `Closing consumer for participant: ${participantId}`);
        consumer.close();
      });
      
      // Stop local stream
      if (localStream) {
        debug('cleanup', 'Stopping local stream tracks');
        localStream.getTracks().forEach(track => track.stop());
      }
      
      // Disconnect socket
      if (socketRef.current) {
        debug('cleanup', 'Disconnecting socket');
        socketRef.current.disconnect();
      }
      
      debug('cleanup', 'Cleanup complete');
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