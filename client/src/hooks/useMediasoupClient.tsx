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
        query: { roomToken, userId }
      });
      
      socketRef.current = newSocket;
      roomTokenRef.current = roomToken;
      userIdRef.current = userId;
      nicknameRef.current = nickname;
      debug('connect', 'Socket reference updated, waiting for connect event');
      
      // Socket event listeners
      newSocket.on('connect', () => {
        debug('socket', `Socket connected with ID: ${newSocket.id}`);
        
        // Join the room
        setTimeout(() => {
          debug('socket', `Joining room with userId: ${userId}, nickname: ${nickname}`);
          
          // First join room via socket.io, с обработкой ошибок и фолбеком на событие
          const joinRoomRequest = { roomToken, userId, nickname };
          
          // Подписываемся на ответное событие для случая, если колбэк не сработает
          newSocket.once('joinRoomResponse', (response: any) => {
            debug('socket', `Received joinRoomResponse via event: ${JSON.stringify(response)}`);
            handleJoinRoomResponse(response);
          });
          
          // Отправляем событие с обычным колбеком
          newSocket.emit('joinRoom', joinRoomRequest, (response: any) => {
            debug('socket', `Received joinRoom callback response: ${JSON.stringify(response)}`);
            handleJoinRoomResponse(response);
          });
          
          // Функция обработки ответа на joinRoom, чтобы не дублировать код
          const handleJoinRoomResponse = (response: any) => {
            if (response && response.success) {
              debug('socket', `Joined room via Socket.IO: ${roomToken}, response: ${JSON.stringify(response)}`);
              
              // Отписываемся от ответного события, если уже получили ответ через колбэк
              newSocket.off('joinRoomResponse');
              
              // Then use the mediasoup signaling
              debug('socket', 'Sending join-room request via mediasoup signaling');
              
              // Отладочная информация о текущих подписках
              debug('listeners', `Current socket listeners:`, {
                'join-room': newSocket.listeners('join-room').length,
                'get-rtp-capabilities': newSocket.listeners('get-rtp-capabilities').length
              });
              
              newSocket.emit('join-room', { userId, nickname }, async (response: any) => {
                debug('socket', 'Received join-room response', response);
                
                // Проверка является ли ответ undefined (отсутствие колбэка)
                if (response === undefined) {
                  debug('socket', 'WARNING: join-room response is undefined, possibly no server handler!');
                  setState(prev => ({ ...prev, error: 'Server did not respond to join-room request' }));
                  return;
                }
                
                if (response && response.success) {
                  debug('socket', `Join-room successful with ${response.participants?.length || 0} participants`);
                  
                  // Debug the participant list we received before setting
                  debug('participants', 'Initial participants list:', 
                    (response.participants || []).map((p: any) => ({ id: p.id, nickname: p.nickname }))
                  );
                  
                  // Set participants list, ensuring it's an array
                  setParticipants(response.participants || []);
                  
                  // Load device with router RTP capabilities
                  debug('socket', 'Requesting RTP capabilities');
                  newSocket.emit('get-rtp-capabilities', { userId }, async (response: any) => {
                    debug('socket', 'Received RTP capabilities response', response);
                    
                    // Проверка является ли ответ undefined
                    if (response === undefined) {
                      debug('socket', 'WARNING: get-rtp-capabilities response is undefined, possibly no server handler!');
                      setState(prev => ({ ...prev, error: 'Server did not respond to RTP capabilities request' }));
                      return;
                    }
                    
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
            } else {
              debug('socket', 'Failed to join room via Socket.IO', response?.error || 'Unknown error');
              setState(prev => ({ ...prev, error: 'Failed to join Socket.IO room' }));
            }
          };
        }, 500); // Small delay to ensure socket connection is stable
      });
      
      // Handle participant joined
      newSocket.on('participant-joined', (participant: Participant) => {
        debug('participants', `Participant joined: ${participant.id} (${participant.nickname})`, participant);
        
        // Проверяем список участников ДО обновления для отладки
        debug('participants', 'Current participants before update:', 
          participants.map(p => ({ id: p.id, nickname: p.nickname }))
        );
        
        // Убедимся, что не добавляем дублирующих участников
        setParticipants(prev => {
          // Если участник уже есть в списке, обновим его данные
          if (prev.some(p => p.id === participant.id)) {
            debug('participants', `Participant ${participant.id} already exists, updating info`);
            return prev.map(p => p.id === participant.id ? {...p, ...participant} : p);
          }
          
          // Если это новый участник, добавляем его
          debug('participants', `Adding new participant: ${participant.id} (${participant.nickname})`);
          return [...prev, participant];
        });
        
        // После обновления списка логируем для проверки
        debug('participants', 'Updated participants after join event. Triggering visual update.');
        
        // Принудительно обновляем UI после добавления участника
        setTimeout(() => {
          debug('participants', 'Forcing UI refresh check for participant list');
        }, 500);
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
  
  // Create a local transport and connect it to the server
  // This will allow us to send media to the server
  const createSendTransport = useCallback(async () => {
    if (!state.device?.loaded || !socketRef.current) {
      debug('transport', 'Cannot create send transport: device not loaded or socket not connected');
      return null;
    }
    
    // Already have a producer transport
    if (state.producerTransport) {
      debug('transport', 'Producer transport already exists, reusing');
      return state.producerTransport;
    }
    
    debug('transport', 'Requesting WebRTC parameters for send transport');
    
    // Get transport parameters from the server
    return new Promise<any>((resolve) => {
      if (!socketRef.current) {
        debug('transport', 'Socket not connected, cannot create send transport');
        resolve(null);
        return;
      }
      
      socketRef.current.emit('create-producer-transport', {
        userId: userIdRef.current
      }, async (response: any) => {
        try {
          debug('transport', 'Received transport parameters', response);
          
          if (!response || !response.success) {
            debug('transport', 'Failed to create producer transport', response?.error || 'Unknown error');
            setState(prev => ({ ...prev, error: 'Failed to create video transport' }));
            resolve(null);
            return;
          }
          
          // Create a new transport using the parameters from the server
          const transport = state.device!.createSendTransport({
            id: response.transport.id,
            iceParameters: response.transport.iceParameters,
            iceCandidates: response.transport.iceCandidates,
            dtlsParameters: response.transport.dtlsParameters,
            sctpParameters: response.transport.sctpParameters,
          });
          
          debug('transport', `Send transport created with ID: ${transport.id}`);
          
          // Set up listeners for transport events
          transport.on('connect', ({ dtlsParameters }, callback, errback) => {
            debug('transport', 'Send transport connect event triggered');
            socketRef.current?.emit('connect-producer-transport', {
              userId: userIdRef.current,
              transportId: transport.id,
              dtlsParameters
            }, (response: any) => {
              if (response && response.success) {
                debug('transport', 'Producer transport connected successfully');
                callback();
              } else {
                debug('transport', 'Failed to connect producer transport', response?.error || 'Unknown error');
                errback(new Error('Failed to connect transport'));
              }
            });
          });
          
          transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
            debug('transport', `Produce event triggered. Kind: ${kind}`);
            socketRef.current?.emit('produce', {
              userId: userIdRef.current,
              transportId: transport.id,
              kind,
              rtpParameters,
              appData
            }, (response: any) => {
              if (response && response.success) {
                debug('transport', `Producer created successfully with ID: ${response.producerId}`);
                callback({ id: response.producerId });
              } else {
                debug('transport', 'Failed to create producer', response?.error || 'Unknown error');
                errback(new Error('Failed to create producer'));
              }
            });
          });
          
          transport.on('connectionstatechange', (state) => {
            debug('transport', `Producer transport connection state changed to: ${state}`);
            // If the transport closes or fails, set state
            if (state === 'failed' || state === 'closed') {
              debug('transport', 'Producer transport failed or closed');
              setState(prev => ({ ...prev, error: 'Video connection failed' }));
            }
          });
          
          // Set current state
          setState(prev => ({ ...prev, producerTransport: transport }));
          
          // Resolve with the created transport
          resolve(transport);
        } catch (error) {
          debug('transport', 'Error creating send transport', error);
          setState(prev => ({ ...prev, error: 'Failed to setup video transport' }));
          resolve(null);
        }
      });
    });
  }, [state.device, state.producerTransport, userIdRef]);
  
  // Start local video with retry mechanism and better error handling
  const startLocalVideo = useCallback(async () => {
    // Check prerequisites
    if (!socketRef.current || !userIdRef.current) {
      debug('video', 'Cannot start video: socket not connected or missing userId');
      setState(prev => ({ ...prev, error: 'Connection not ready' }));
      return;
    }
    
    debug('video', 'Starting local video with full debugging');
    
    try {
      // 1. Stop existing tracks if any
      if (localStream) {
        debug('video', 'Stopping existing local stream tracks');
        localStream.getTracks().forEach(track => {
          debug('video', `Stopping track: ${track.kind}, ID: ${track.id}`);
          track.stop();
        });
      }
      
      // 2. Get user media with more robust error handling
      debug('video', 'Requesting user media...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true,
        audio: false
      });
      
      debug('video', `User media obtained with ${stream.getVideoTracks().length} video tracks`);
      
      // Store the local stream
      setLocalStream(stream);
      
      // 3. Create the send transport if needed
      debug('video', 'Creating send transport...');
      const transport = await createSendTransport();
      
      if (!transport) {
        throw new Error('Failed to create send transport');
      }
      
      debug('video', 'Send transport created, producing video...');
      
      // 4. Create a producer with the first video track
      const track = stream.getVideoTracks()[0];
      
      if (!track) {
        throw new Error('No video track found in stream');
      }
      
      debug('video', `Producing track: ${track.kind}, ID: ${track.id}, Label: ${track.label}`);
      
      const producer = await transport.produce({
        track,
        encodings: [
          { maxBitrate: 100000, scaleResolutionDownBy: 4 },
          { maxBitrate: 300000, scaleResolutionDownBy: 2 },
          { maxBitrate: 900000 }
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000
        }
      });
      
      debug('video', `Producer created with ID: ${producer.id}`);
      
      // Store the producer in state
      setState(prev => ({ ...prev, producer, isProducing: true }));
      
      // 5. Notify the server that the local video is now enabled
      socketRef.current.emit('update-video-status', {
        userId: userIdRef.current,
        hasVideo: true
      }, (response: any) => {
        debug('video', 'Video status update response:', response);
      });
      
      debug('video', 'Local video started successfully');
    } catch (error) {
      console.error('Error starting local video:', error);
      debug('video', 'Failed to start local video', error);
      
      // Handle common camera access errors with user-friendly messages
      let errorMessage = 'Failed to access camera';
      
      if (error instanceof DOMException) {
        if (error.name === 'NotFoundError') {
          errorMessage = 'No camera found. Please connect a camera.';
        } else if (error.name === 'NotAllowedError') {
          errorMessage = 'Camera access denied. Please allow camera access in your browser.';
        } else if (error.name === 'AbortError') {
          errorMessage = 'Camera is being used by another application.';
        }
      }
      
      setState(prev => ({ ...prev, error: errorMessage }));
    }
  }, [socketRef.current, userIdRef.current, localStream, createSendTransport]);
  
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