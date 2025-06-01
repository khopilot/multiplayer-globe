import "./styles.css";
import "leaflet/dist/leaflet.css";

import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import createGlobe from "cobe";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import usePartySocket from "partysocket/react";

// The type of messages we'll be receiving from the server
import type { OutgoingMessage, DebtorInfo } from "../shared";
import type { LegacyRef } from "react";

// Fix Leaflet icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom marker icons
const createCustomIcon = (status: string, isCurrentUser: boolean) => {
  const emoji = isCurrentUser ? '👤' : '💰';
  const color = status === 'defaulted' ? '#ff0000' : status === 'paid' ? '#00ff00' : '#ff9900';
  return L.divIcon({
    html: `
      <div class="custom-marker ${isCurrentUser ? 'pulse' : ''}" style="background-color: ${color};">
        <span>${emoji}</span>
      </div>
    `,
    className: 'custom-div-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  });
};

// Format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

// Format date
const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

// Get status badge
const getStatusBadge = (status: string) => {
  const badges = {
    active: { text: 'Active', color: '#ff9900' },
    defaulted: { text: 'Defaulted', color: '#ff0000' },
    paid: { text: 'Paid', color: '#00ff00' },
    legal: { text: 'Legal Action', color: '#ff00ff' }
  };
  return badges[status as keyof typeof badges] || badges.active;
};

// Map component to handle dynamic centering
function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 7);
  }, [center, map]);
  return null;
}

// Generate or get persistent user ID
function getPersistentUserId(): string {
  const STORAGE_KEY = 'bones_locator_user_id';
  let userId = localStorage.getItem(STORAGE_KEY);
  
  if (!userId) {
    // Generate a new UUID-like ID
    userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem(STORAGE_KEY, userId);
  }
  
  return userId;
}

function App() {
  // State for geolocation permission
  const [hasPermission, setHasPermission] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [viewMode, setViewMode] = useState<'globe' | 'map'>('globe');
  const [userId] = useState(getPersistentUserId()); // Get persistent user ID

  // Request geolocation permission
  const requestLocationPermission = async () => {
    setIsRequestingPermission(true);
    setPermissionError(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });

      const { latitude, longitude } = position.coords;
      setUserLocation({ lat: latitude, lng: longitude });
      setHasPermission(true);
    } catch (error) {
      if (error instanceof GeolocationPositionError) {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setPermissionError("You must allow access to your location to use this application.");
            break;
          case error.POSITION_UNAVAILABLE:
            setPermissionError("Unable to retrieve your location. Please check your location settings.");
            break;
          case error.TIMEOUT:
            setPermissionError("Location request timed out. Please try again.");
            break;
          default:
            setPermissionError("An error occurred while accessing your location.");
        }
      } else {
        setPermissionError("An unknown error occurred.");
      }
    } finally {
      setIsRequestingPermission(false);
    }
  };

  // Permission screen component
  if (!hasPermission) {
    return (
      <div className="permission-screen">
        <div className="permission-content">
          <h1>💀 Bones Locator</h1>

          {permissionError && (
            <div className="permission-error">
              ⚠️ {permissionError}
            </div>
          )}

          <button 
            className="permission-button"
            onClick={requestLocationPermission}
            disabled={isRequestingPermission}
          >
            {isRequestingPermission ? (
              "Requesting..."
            ) : (
              "Allow Location Access"
            )}
          </button>

          <p className="permission-note">
            💡 You can revoke this permission at any time in your browser settings.
          </p>
        </div>
      </div>
    );
  }

  return <MainView userLocation={userLocation!} viewMode={viewMode} setViewMode={setViewMode} userId={userId} />;
}

interface MainViewProps {
  userLocation: { lat: number; lng: number };
  viewMode: 'globe' | 'map';
  setViewMode: (mode: 'globe' | 'map') => void;
  userId: string;
}

function MainView({ userLocation, viewMode, setViewMode, userId }: MainViewProps) {
  // A reference to the canvas element where we'll render the globe
  const canvasRef = useRef<HTMLCanvasElement>();
  // The number of markers we're currently displaying
  const [counter, setCounter] = useState(0);
  // Store debtors with their information
  const [debtors, setDebtors] = useState<Map<string, DebtorInfo>>(new Map());
  // A map of marker IDs to their positions
  const positions = useRef<
    Map<
      string,
      {
        location: [number, number];
        size: number;
      }
    >
  >(new Map());
  
  // Connect to the PartyServer server with user's real location
  const socket = usePartySocket({
    room: "default",
    party: "globe",
    query: {
      lat: userLocation.lat.toString(),
      lng: userLocation.lng.toString(),
      userId: userId // Send persistent user ID
    },
    onMessage(evt) {
      const message = JSON.parse(evt.data as string) as OutgoingMessage;
      console.log("Message received:", message);
      
      if (message.type === "add-debtor" || message.type === "update-debtor") {
        // Add/update the marker on our map
        positions.current.set(message.debtor.position.id, {
          location: [message.debtor.position.lat, message.debtor.position.lng],
          size: 0,
        });
        // Update the debtors map with full debtor data
        setDebtors((prevDebtors) => {
          const newDebtors = new Map(prevDebtors);
          newDebtors.set(message.debtor.position.id, message.debtor);
          return newDebtors;
        });
        // Update the counter
        if (message.type === "add-debtor" && !debtors.has(message.debtor.position.id)) {
          setCounter((c) => c + 1);
        }
      } else if (message.type === "remove-debtor") {
        // Remove the marker from our map
        positions.current.delete(message.id);
        // Remove from debtors map
        setDebtors((prevDebtors) => {
          const newDebtors = new Map(prevDebtors);
          newDebtors.delete(message.id);
          return newDebtors;
        });
        // Update the counter
        setCounter((c) => c - 1);
      }
    },
  });

  useEffect(() => {
    if (viewMode !== 'globe' || !canvasRef.current) return;

    // The angle of rotation of the globe
    let phi = 0;
    let autoRotate = true;

    const globe = createGlobe(canvasRef.current as HTMLCanvasElement, {
      devicePixelRatio: 2,
      width: canvasRef.current.offsetWidth * 2,
      height: canvasRef.current.offsetHeight * 2,
      phi: 0,
      theta: -0.2, // Adjust to center on Cambodia
      dark: 1,
      diffuse: 0.4,
      mapSamples: 16000,
      mapBrightness: 4,
      baseColor: [0.2, 0.2, 0.2],
      markerColor: [0.9, 0.1, 0.1],
      glowColor: [0.5, 0.1, 0.1],
      markers: [],
      opacity: 0.6,
      offset: [0, 0],
      scale: 1,
      onRender: (state) => {
        // Center on Cambodia
        if (!autoRotate) {
          state.phi = phi;
          state.theta = -0.2;
        } else {
          // Auto-rotate around Cambodia
          state.phi = phi;
          state.theta = -0.2;
          phi += 0.003;
        }

        // Get the current positions from our map with smaller sizes
        state.markers = [...positions.current.entries()].map(([id, data]) => ({
          location: data.location,
          size: id === socket.id ? 0.06 : 0.03,
        }));
      },
    });

    // Focus on Cambodia initially
    setTimeout(() => {
      phi = -1.8; // Longitude of Cambodia
    }, 100);

    // Stop rotation on mouse interaction
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('mousedown', () => { autoRotate = false; });
      canvas.addEventListener('mouseup', () => { 
        setTimeout(() => { autoRotate = true; }, 3000);
      });
    }

    return () => {
      globe.destroy();
    };
  }, [socket.id, viewMode]);

  // Calculate center of map based on debtors positions or default to Cambodia
  const mapCenter: [number, number] = debtors.size > 0 
    ? [
        Array.from(debtors.values()).reduce((sum, d) => sum + d.position.lat, 0) / debtors.size,
        Array.from(debtors.values()).reduce((sum, d) => sum + d.position.lng, 0) / debtors.size
      ]
    : [11.5564, 104.9282]; // Phnom Penh, Cambodia

  // Calculate total statistics
  const stats = {
    totalDebt: Array.from(debtors.values()).reduce((sum, d) => sum + d.outstandingBalance, 0),
    defaultedCount: Array.from(debtors.values()).filter(d => d.status === 'defaulted').length,
    totalMissedPayments: Array.from(debtors.values()).reduce((sum, d) => sum + d.missedPayments, 0)
  };

  return (
    <div className="App">
      <header className="app-header">
        <h1>💀 Bones Locator</h1>
        <div className="header-controls">
          <div className="view-toggle">
            <button 
              className={`toggle-btn ${viewMode === 'globe' ? 'active' : ''}`}
              onClick={() => setViewMode('globe')}
            >
              🌍 Globe
            </button>
            <button 
              className={`toggle-btn ${viewMode === 'map' ? 'active' : ''}`}
              onClick={() => setViewMode('map')}
            >
              🗺️ Cambodia
            </button>
          </div>
          <p className="connection-status">
            {counter !== 0 ? (
              <>
                <b>{counter}</b> {counter === 1 ? "debtor tracked" : "debtors tracked"} | 
                Total: <b>{formatCurrency(stats.totalDebt)}</b>
              </>
            ) : (
              "Waiting for connections..."
            )}
          </p>
        </div>
      </header>

      <div className="main-container">
        {/* Left side - Globe or Map */}
        <div className="visualization-container">
          {viewMode === 'globe' ? (
            <canvas
              ref={canvasRef as LegacyRef<HTMLCanvasElement>}
              style={{ width: '100%', height: '100%', cursor: 'grab' }}
            />
          ) : (
            <MapContainer 
              center={mapCenter} 
              zoom={7} 
              style={{ width: '100%', height: '100%' }}
              className="leaflet-container"
            >
              <MapUpdater center={mapCenter} />
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              />
              {Array.from(debtors.entries()).map(([id, debtor]) => {
                const isCurrentUser = id === socket.id;
                return (
                  <Marker 
                    key={id} 
                    position={[debtor.position.lat, debtor.position.lng]}
                    icon={createCustomIcon(debtor.status, isCurrentUser)}
                  >
                    <Popup>
                      <div className="marker-popup">
                        <h4>{isCurrentUser ? "👤 Your position" : `💰 ${debtor.name}`}</h4>
                        <p className="status-line">
                          Status: <span style={{ color: getStatusBadge(debtor.status).color }}>
                            {getStatusBadge(debtor.status).text}
                          </span>
                        </p>
                        <p>📍 {debtor.position.lat.toFixed(4)}°, {debtor.position.lng.toFixed(4)}°</p>
                        <p>💵 Outstanding: {formatCurrency(debtor.outstandingBalance)}</p>
                        <p>⚠️ Missed Payments: {debtor.missedPayments}</p>
                        <p>📅 Due: {formatDate(debtor.dueDate)}</p>
                        {debtor.phoneNumber && <p>📱 {debtor.phoneNumber}</p>}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          )}
        </div>

        {/* Right side - Debtors list */}
        <div className="users-panel">
          <h2>💰 Tracked Debtors</h2>
          
          {/* Summary Stats */}
          {debtors.size > 0 && (
            <div className="stats-summary">
              <div className="stat-item">
                <span className="stat-label">Total Outstanding</span>
                <span className="stat-value">{formatCurrency(stats.totalDebt)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Defaulted</span>
                <span className="stat-value error">{stats.defaultedCount}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Missed Payments</span>
                <span className="stat-value warning">{stats.totalMissedPayments}</span>
              </div>
            </div>
          )}

          {debtors.size > 0 ? (
            <div className="users-list-container">
              <ul className="users-list">
                {Array.from(debtors.entries()).map(([id, debtor]) => {
                  const isCurrentUser = id === socket.id;
                  const statusBadge = getStatusBadge(debtor.status);
                  return (
                    <li key={id} className={`user-item debtor-item ${debtor.status}`}>
                      <div className="debtor-header">
                        <span className={`user-name ${isCurrentUser ? "current-user" : ""}`}>
                          {isCurrentUser ? "👤 You" : `💰 ${debtor.name}`}
                        </span>
                        <span className="status-badge" style={{ backgroundColor: statusBadge.color }}>
                          {statusBadge.text}
                        </span>
                      </div>
                      <div className="debtor-details">
                        <div className="detail-row">
                          <span className="detail-label">Outstanding:</span>
                          <span className="detail-value">{formatCurrency(debtor.outstandingBalance)}</span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Original Loan:</span>
                          <span className="detail-value">{formatCurrency(debtor.loanAmount)}</span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Interest Rate:</span>
                          <span className="detail-value">{debtor.interestRate.toFixed(1)}%</span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Due Date:</span>
                          <span className="detail-value">{formatDate(debtor.dueDate)}</span>
                        </div>
                        {debtor.missedPayments > 0 && (
                          <div className="detail-row error">
                            <span className="detail-label">⚠️ Missed Payments:</span>
                            <span className="detail-value">{debtor.missedPayments}</span>
                          </div>
                        )}
                        <div className="detail-row location">
                          <span className="detail-label">📍 Location:</span>
                          <span className="detail-value">🇰🇭 {debtor.position.lat.toFixed(4)}°, {debtor.position.lng.toFixed(4)}°</span>
                        </div>
                        {debtor.phoneNumber && (
                          <div className="detail-row">
                            <span className="detail-label">📱 Phone:</span>
                            <span className="detail-value">{debtor.phoneNumber}</span>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="info-note">
                💡 Real-time GPS tracking of debtors in Cambodia
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>No debtors currently tracked</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById("root")!).render(<App />);
