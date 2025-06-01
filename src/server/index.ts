import { routePartykitRequest, Server } from "partyserver";

import type { OutgoingMessage, Position, DebtorInfo } from "../shared";
import type { Connection, ConnectionContext } from "partyserver";

// This is the state that we'll store on each connection
type ConnectionState = {
  userId: string;
  connectionId: string;
};

export class Globe extends Server {
  // Map to track active debtors by userId
  private debtors = new Map<string, DebtorInfo>();
  // Map to track connections per userId
  private userConnections = new Map<string, Set<string>>();

  onConnect(conn: Connection<ConnectionState>, ctx: ConnectionContext) {
    // First, try to get position from query parameters (real GPS coordinates)
    const url = new URL(ctx.request.url);
    const queryLat = url.searchParams.get("lat");
    const queryLng = url.searchParams.get("lng");
    const userId = url.searchParams.get("userId") || conn.id; // Use persistent userId or fallback to conn.id
    
    let latitude: string | undefined;
    let longitude: string | undefined;
    
    if (queryLat && queryLng) {
      // Use precise GPS coordinates from client
      latitude = queryLat;
      longitude = queryLng;
      console.log(`Using precise GPS coordinates for user ${userId}: ${latitude}, ${longitude}`);
    } else {
      // Fallback to Cloudflare IP-based location
      latitude = ctx.request.cf?.latitude as string | undefined;
      longitude = ctx.request.cf?.longitude as string | undefined;
      console.log(`Using IP-based coordinates for user ${userId}: ${latitude}, ${longitude}`);
    }
    
    if (!latitude || !longitude) {
      console.warn(`Missing position information for user ${userId}`);
      conn.send(JSON.stringify({ 
        type: "error", 
        message: "GPS position required to use this application" 
      }));
      conn.close();
      return;
    }
    
    // Save connection state
    conn.setState({
      userId,
      connectionId: conn.id
    });

    // Track this connection for the user
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(conn.id);

    // Check if this user already exists
    let debtorInfo = this.debtors.get(userId);
    
    if (!debtorInfo) {
      // Create new debtor info only if user doesn't exist
      const position: Position = {
        lat: parseFloat(latitude),
        lng: parseFloat(longitude),
        id: userId, // Use userId instead of conn.id
      };
      
      debtorInfo = {
        position,
        loanAmount: Math.floor(Math.random() * 5000) + 500,
        outstandingBalance: Math.floor(Math.random() * 5000) + 100,
        missedPayments: Math.floor(Math.random() * 5),
        dueDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        interestRate: 5 + Math.random() * 10,
        status: Math.random() > 0.7 ? 'defaulted' : 'active',
        name: `Debtor ${userId.slice(0, 6)}`,
        phoneNumber: `+855 ${Math.floor(Math.random() * 90000000 + 10000000)}`
      };
      
      this.debtors.set(userId, debtorInfo);
      
      // Broadcast new debtor to all connections
      this.broadcast(
        JSON.stringify({
          type: "add-debtor",
          debtor: debtorInfo,
        } satisfies OutgoingMessage)
      );
    } else {
      // Update position for existing debtor
      debtorInfo.position.lat = parseFloat(latitude);
      debtorInfo.position.lng = parseFloat(longitude);
      
      // Send current state to new connection
      conn.send(
        JSON.stringify({
          type: "add-debtor",
          debtor: debtorInfo,
        } satisfies OutgoingMessage)
      );
      
      // Send all other debtors to new connection
      for (const [otherUserId, otherDebtor] of this.debtors) {
        if (otherUserId !== userId) {
          conn.send(
            JSON.stringify({
              type: "add-debtor",
              debtor: otherDebtor,
            } satisfies OutgoingMessage)
          );
        }
      }
    }
  }

  onClose(connection: Connection<ConnectionState>): void | Promise<void> {
    this.handleDisconnect(connection);
  }

  onError(connection: Connection<ConnectionState>): void | Promise<void> {
    this.handleDisconnect(connection);
  }

  private handleDisconnect(connection: Connection<ConnectionState>) {
    const state = connection.state;
    if (!state) return;
    
    const { userId, connectionId } = state;
    
    // Remove this connection from user's connections
    const userConns = this.userConnections.get(userId);
    if (userConns) {
      userConns.delete(connectionId);
      
      // Only remove debtor if this was the last connection for this user
      if (userConns.size === 0) {
        this.userConnections.delete(userId);
        this.debtors.delete(userId);
        
        // Broadcast removal only when last connection closes
        this.broadcast(
          JSON.stringify({
            type: "remove-debtor",
            id: userId,
          } satisfies OutgoingMessage),
          [connectionId]
        );
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, { ...env })) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;

