import WebSocket from "ws";

type WebRTCSignalingMessage = {
  type: 'webrtc';
  action: 'offer' | 'answer' | 'ice-candidate';
  sender: string;
  receiver: string;
  roomToken: string;
  payload: any;
};

/**
 * Handle WebRTC signaling messages between peers
 */
export function handleWebRTCSignaling(
  message: WebRTCSignalingMessage,
  clients: Map<string, Map<string, WebSocket>>
) {
  const { roomToken, sender, receiver, payload } = message;
  
  // Get the room's clients
  const roomClients = clients.get(roomToken);
  if (!roomClients) {
    console.error(`Room ${roomToken} not found for signaling`);
    return;
  }
  
  // Get the receiver client
  const receiverClient = roomClients.get(receiver);
  if (!receiverClient || receiverClient.readyState !== WebSocket.OPEN) {
    console.error(`Receiver ${receiver} not found or not connected`);
    return;
  }
  
  // Forward the signaling message to the receiver
  receiverClient.send(JSON.stringify(message));
}
