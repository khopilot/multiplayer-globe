import { routePartykitRequest, Server } from "partyserver";

import type { OutgoingMessage, Position, DebtorInfo } from "../shared";
import type { Connection, ConnectionContext } from "partyserver";

// This is the state that we'll store on each connection
type ConnectionState = {
  debtor: DebtorInfo;
};

export class Globe extends Server {
  onConnect(conn: Connection<ConnectionState>, ctx: ConnectionContext) {
    // Whenever a fresh connection is made, we'll
    // send the entire state to the new connection

    // First, try to get position from query parameters (real GPS coordinates)
    const url = new URL(ctx.request.url);
    const queryLat = url.searchParams.get("lat");
    const queryLng = url.searchParams.get("lng");
    
    let latitude: string | undefined;
    let longitude: string | undefined;
    
    if (queryLat && queryLng) {
      // Use precise GPS coordinates from client
      latitude = queryLat;
      longitude = queryLng;
      console.log(`Using precise GPS coordinates for connection ${conn.id}: ${latitude}, ${longitude}`);
    } else {
      // Fallback to Cloudflare IP-based location
      latitude = ctx.request.cf?.latitude as string | undefined;
      longitude = ctx.request.cf?.longitude as string | undefined;
      console.log(`Using IP-based coordinates for connection ${conn.id}: ${latitude}, ${longitude}`);
    }
    
    if (!latitude || !longitude) {
      console.warn(`Missing position information for connection ${conn.id}`);
      conn.send(JSON.stringify({ 
        type: "error", 
        message: "GPS position required to use this application" 
      }));
      conn.close();
      return;
    }
    
    const position: Position = {
      lat: parseFloat(latitude),
      lng: parseFloat(longitude),
      id: conn.id,
    };
    
    // Create debtor info with sample data (in real app, this would come from a database)
    const debtorInfo: DebtorInfo = {
      position,
      loanAmount: Math.floor(Math.random() * 5000) + 500, // Random loan between $500-$5500
      outstandingBalance: Math.floor(Math.random() * 5000) + 100,
      missedPayments: Math.floor(Math.random() * 5),
      dueDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      interestRate: 5 + Math.random() * 10, // 5-15% interest
      status: Math.random() > 0.7 ? 'defaulted' : 'active',
      name: `Debtor ${conn.id.slice(0, 6)}`,
      phoneNumber: `+855 ${Math.floor(Math.random() * 90000000 + 10000000)}` // Cambodia phone
    };
    
    // And save this on the connection's state
    conn.setState({
      debtor: debtorInfo,
    });

    // Now, let's send the entire state to the new connection
    for (const connection of this.getConnections<ConnectionState>()) {
      try {
        conn.send(
          JSON.stringify({
            type: "add-debtor",
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            debtor: connection.state!.debtor,
          } satisfies OutgoingMessage),
        );

        // And let's send the new connection's debtor info to all other connections
        if (connection.id !== conn.id) {
          connection.send(
            JSON.stringify({
              type: "add-debtor",
              debtor: debtorInfo,
            } satisfies OutgoingMessage),
          );
        }
      } catch {
        this.onCloseOrError(conn);
      }
    }
  }

  // Whenever a connection closes (or errors), we'll broadcast a message to all
  // other connections to remove the marker.
  onCloseOrError(connection: Connection) {
    this.broadcast(
      JSON.stringify({
        type: "remove-debtor",
        id: connection.id,
      } satisfies OutgoingMessage),
      [connection.id],
    );
  }

  onClose(connection: Connection): void | Promise<void> {
    this.onCloseOrError(connection);
  }

  onError(connection: Connection): void | Promise<void> {
    this.onCloseOrError(connection);
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
