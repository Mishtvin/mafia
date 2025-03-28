import React, { useContext } from 'react';
import './App.css';
import { Switch, Route } from "wouter";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import RoomProvider, { RoomContext } from './providers/RoomProvider';
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Room from "@/pages/Room";
import VirtualRoom from './VirtualRoom';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/room/:token" component={Room} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const { roomToken, userId, username, webcamState, roomState } = useContext(RoomContext);

  return (
    <QueryClientProvider client={queryClient}>
      <RoomProvider>
        <Router />
      </RoomProvider>
      <Toaster />
      {/* Debug info */}
      {process.env.NODE_ENV === 'development' && (
        <div className="debug-info" style={{
          position: 'fixed',
          bottom: '10px',
          left: '10px',
          background: 'rgba(0,0,0,0.7)',
          color: 'white',
          padding: '10px',
          borderRadius: '5px',
          fontSize: '12px',
          zIndex: 9999
        }}>
          <div>Room: {roomToken || 'Not joined'}</div>
          <div>User ID: {userId}</div>
          <div>Username: {username}</div>
          <div>Video Enabled: {webcamState?.enabled ? 'Yes' : 'No'}</div>
          <div>Producer Created: {webcamState?.producerCreated ? 'Yes' : 'No'}</div>
          <div>Local Stream: {webcamState?.localStream ? 'Available' : 'Not available'}</div>
          <div>Participants: {roomState ? roomState.participants.length : 0}</div>
          <div>Status: {roomState ? roomState.error || 'Connected' : 'Not connected'}</div>
        </div>
      )}
    </QueryClientProvider>
  );
}

export default App;
