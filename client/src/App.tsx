import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { queryClient } from "./lib/queryClient";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Room from "@/pages/Room";
import { RoomProvider } from "@/context/RoomContext";

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
  return (
    <QueryClientProvider client={queryClient}>
      <RoomProvider>
        <Router />
      </RoomProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
