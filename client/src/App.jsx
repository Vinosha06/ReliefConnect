import { useEffect, useState, useCallback, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, useMap } from "react-leaflet";
import { io } from "socket.io-client";
import "leaflet/dist/leaflet.css";

const API_BASE = "http://localhost:4000/api";

const api = (path, body) =>
  fetch(API_BASE + path, body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

const ITEMS = [
  "food", 
  "water", 
  "medicine", 
  "boat", 
  "transport", 
  "shelter", 
  "clothes", 
  "power/generator", 
  "baby_products"
];

const COLOR = {
  requested: "#ef4444",
  assigned: "#f59e0b",
  delivered: "#10b981",
  resource: "#06b6d4"
};

const URGENCY_LABEL = { 1: "Low", 2: "Medium", 3: "High" };
const URGENCY_COLOR = { 1: "#10b981", 2: "#f59e0b", 3: "#ef4444" };

function Picker({ onPick }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

function RecenterMap({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("user") || "null"));
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("theme") === "dark");
  const [needs, setNeeds] = useState([]);
  const [resources, setResources] = useState([]);
  const [matches, setMatches] = useState({});
  const [pos, setPos] = useState([6.9271, 79.8612]);
  const [item, setItem] = useState("food");
  const [qty, setQty] = useState(1);
  const [urgency, setUrgency] = useState(2);
  const [alertMsg, setAlertMsg] = useState("");
  const [isLive, setIsLive] = useState(true);

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [filterItem, setFilterItem] = useState("all");
  const [filterUrgency, setFilterUrgency] = useState("all");

  // Mobile Responsive State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const watchIdRef = useRef(null);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setIsSidebarOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const load = useCallback(async () => {
    try { 
      setNeeds(await api("/needs")); 
      setResources(await api("/resources")); 
    } catch (e) { 
      console.error("Data loading error:", e); 
    }
  }, []);

  const toggleTheme = () => {
    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };

  useEffect(() => {
    if ("geolocation" in navigator && isLive) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (p) => {
          setPos([p.coords.latitude, p.coords.longitude]);
        },
        (err) => console.error("GPS Error:", err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [isLive]);

  useEffect(() => {
    load();
    const s = io("http://localhost:4000");
    s.on("changed", load);
    s.on("need:new", (n) => { 
      setAlertMsg(`🚨 නව ඉල්ලීමක්: ${n.item_type} × ${n.quantity}`); 
      setTimeout(() => setAlertMsg(""), 6000); 
    });
    return () => s.disconnect();
  }, [load]);

  const join = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const phone = f.get("phone").trim();
    
    if (!/^\d{9,12}$/.test(phone)) {
      alert("தயவுசெய்து சரியான தொலைபேසි අංකයක් ඇතුළත් කරන්න (Valid phone number required)");
      return;
    }

    try {
      const u = await api("/users", { 
        name: f.get("name").trim(), 
        phone: phone, 
        role: f.get("role"),
        password: f.get("password") 
      });
      localStorage.setItem("user", JSON.stringify(u)); 
      setUser(u);
    } catch (err) {
      alert("Login Error: " + err.message);
    }
  };

  // Filter Logic for Needs
  const filteredNeeds = needs.filter((n) => {
    const matchesSearch = n.item_type.toLowerCase().includes(searchQuery.toLowerCase()) || n.id.toString().includes(searchQuery);
    const matchesItem = filterItem === "all" || n.item_type === filterItem;
    const matchesUrgency = filterUrgency === "all" || n.urgency.toString() === filterUrgency;
    return matchesSearch && matchesItem && matchesUrgency;
  });

  // Calculate System Stats Summary
  const stats = {
    totalNeeds: needs.length,
    requested: needs.filter(n => n.status === "requested").length,
    assigned: needs.filter(n => n.status === "assigned").length,
    resourcesCount: resources.length
  };

  const theme = {
    bg: darkMode ? "#0f172a" : "#f8fafc",
    sidebarBg: darkMode ? "#1e293b" : "#ffffff",
    cardBg: darkMode ? "#334155" : "#ffffff",
    formBg: darkMode ? "#1e293b" : "#f8fafc",
    textPrimary: darkMode ? "#f8fafc" : "#0f172a",
    textSecondary: darkMode ? "#94a3b8" : "#64748b",
    border: darkMode ? "#334155" : "#e2e8f0",
    inputBg: darkMode ? "#0f172a" : "#ffffff",
    mapTile: "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  };

  if (!user) return (
    <div style={{ ...styles.loginContainer, backgroundColor: theme.bg }}>
      <div style={{ ...styles.loginCard, backgroundColor: theme.sidebarBg, color: theme.textPrimary, borderColor: theme.border }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🤝</div>
        <h2 style={{ ...styles.loginTitle, color: theme.textPrimary }}>ReliefConnect</h2>
        <p style={{ ...styles.loginSubtitle, color: theme.textSecondary }}>Community Disaster Alert & Resource Matcher</p>
        
        <form onSubmit={join} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ ...styles.label, color: theme.textSecondary }}>ඔබේ නම (Full Name)</label>
            <input name="name" style={{ ...styles.input, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border }} placeholder="e.g. Vinosha" required />
          </div>
          <div>
            <label style={{ ...styles.label, color: theme.textSecondary }}>දුරකථන අංකය (Phone)</label>
            <input name="phone" style={{ ...styles.input, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border }} placeholder="e.g. 0771234567" required />
          </div>
          <div>
            <label style={{ ...styles.label, color: theme.textSecondary }}>මුරපදය (Password / PIN)</label>
            <input type="password" name="password" style={{ ...styles.input, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border }} placeholder="••••••••" required />
          </div>
          <div>
            <label style={{ ...styles.label, color: theme.textSecondary }}>ඔබගේ කාර්යභාරය (Role)</label>
            <select name="role" style={{ ...styles.select, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border }}>
              <option value="victim">Victim (උදව් අවශ්‍යයි)</option>
              <option value="donor">Donor (දෙන්න පුළුවන්)</option>
              <option value="volunteer">Volunteer (ස්වේච්ඡා සේවක)</option>
            </select>
          </div>
          <button style={styles.btnPrimary}>ඇතුල් වන්න / ලියාපදිංචි වන්න</button>
        </form>
      </div>
    </div>
  );

  const submit = async () => {
    const qtyNum = Number(qty);
    if (isNaN(qtyNum) || qtyNum < 1) {
      alert("ප්‍රමාණය අවම වශයෙන් 1ක් විය යුතුය!");
      return;
    }

    try {
      const body = { user_id: user.id, item_type: item, quantity: qtyNum, lat: pos[0], lng: pos[1] };
      if (user.role === "victim") {
        await api("/needs", { ...body, urgency: +urgency });
      } else {
        await api("/resources", body);
      }
      await load();
      alert("සාර්ථකව Save විය!");
      if (isMobile) setIsSidebarOpen(false);
    } catch (err) {
      console.error("Submit Error:", err);
      alert("Save කිරීමට නොහැකි විය: " + err.message);
    }
  };

  const toggleLiveGps = () => setIsLive((prev) => !prev);
  const findMatches = async (id) => setMatches({ ...matches, [id]: await api(`/needs/${id}/matches?radius=5000`) });
  const accept = (nid, rid) => api(`/needs/${nid}/accept`, { resource_id: rid, volunteer_id: user.id }).catch((e) => alert(e.message));
  const deliver = (id) => api(`/needs/${id}/deliver`, {});

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", height: "100vh", width: "100vw", overflow: "hidden", fontFamily: "'Inter', system-ui, sans-serif", backgroundColor: theme.bg, color: theme.textPrimary }}>
      
      {/* Mobile Top Navigation Bar */}
      {isMobile && (
        <div style={{ ...styles.mobileHeader, backgroundColor: theme.sidebarBg, borderColor: theme.border }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: theme.textPrimary, display: "flex", alignItems: "center", gap: 6 }}>
            <span>🤝</span> ReliefConnect
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={toggleTheme} style={{ ...styles.btnTheme, backgroundColor: theme.formBg, color: theme.textPrimary, borderColor: theme.border }}>
              {darkMode ? "☀️" : "🌙"}
            </button>
            <button 
              onClick={() => setIsSidebarOpen((prev) => !prev)} 
              style={{ ...styles.btnMenuToggle, backgroundColor: "#2563eb", color: "#ffffff" }}
            >
              {isSidebarOpen ? "✕ Close" : "📋 Form / List"}
            </button>
          </div>
        </div>
      )}

      {/* Sidebar Panel */}
      <div style={{
        ...styles.sidebar,
        backgroundColor: theme.sidebarBg,
        borderColor: theme.border,
        ...(isMobile ? {
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          top: "56px",
          width: "100%",
          zIndex: 9999,
          transform: isSidebarOpen ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.3s ease-in-out"
        } : {})
      }}>
        
        {/* Desktop Header Title */}
        {!isMobile && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: theme.textPrimary, display: "flex", alignItems: "center", gap: 6 }}>
              <span>🤝</span> ReliefConnect
            </div>
            <button onClick={toggleTheme} style={{ ...styles.btnTheme, backgroundColor: theme.formBg, color: theme.textPrimary, borderColor: theme.border }}>
              {darkMode ? "☀️ Light" : "🌙 Dark"}
            </button>
          </div>
        )}

        {/* User Profile Header */}
        <div style={{ ...styles.userHeader, borderColor: theme.border }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: theme.textPrimary }}>{user.name}</div>
            <span style={{ ...styles.badge, backgroundColor: user.role === "victim" ? "#fee2e2" : user.role === "donor" ? "#dcfce7" : "#e0e7ff", color: user.role === "victim" ? "#991b1b" : user.role === "donor" ? "#166534" : "#3730a3" }}>
              {user.role.toUpperCase()}
            </span>
          </div>
          <button style={{ ...styles.btnLogout, borderColor: theme.border, color: theme.textSecondary, backgroundColor: theme.sidebarBg }} onClick={() => { localStorage.clear(); setUser(null); }}>Logout</button>
        </div>

        {/* 📊 System Analytics / Stats Counter Header */}
        <div style={{ ...styles.statsContainer, backgroundColor: theme.formBg, borderColor: theme.border }}>
          <div style={styles.statBox}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#ef4444" }}>{stats.requested}</span>
            <span style={{ fontSize: 10, color: theme.textSecondary, fontWeight: 600 }}>Active Needs</span>
          </div>
          <div style={styles.statBox}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b" }}>{stats.assigned}</span>
            <span style={{ fontSize: 10, color: theme.textSecondary, fontWeight: 600 }}>In Progress</span>
          </div>
          <div style={styles.statBox}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#06b6d4" }}>{stats.resourcesCount}</span>
            <span style={{ fontSize: 10, color: theme.textSecondary, fontWeight: 600 }}>Resources</span>
          </div>
        </div>

        {/* Real-time Alert Message */}
        {alertMsg && <div style={styles.alertBox}>{alertMsg}</div>}

        {/* Input Form for Victims & Donors */}
        {user.role !== "volunteer" && (
          <div style={{ ...styles.formCard, backgroundColor: theme.formBg, borderColor: theme.border }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: 15, color: theme.textPrimary, fontWeight: 700 }}>
              {user.role === "victim" ? "🆘 උදව් ඉල්ලන්න (Request Need)" : "📦 සම්පත් ලබා දෙන්න (Provide Resource)"}
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ ...styles.label, color: theme.textSecondary }}>ද්‍රව්‍යමය වර්ගය (Item Category)</label>
                <select value={item} onChange={(e) => setItem(e.target.value)} style={{ ...styles.select, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border }}>
                  {ITEMS.map((i) => <option key={i} value={i}>{i.toUpperCase().replace("_", " ")}</option>)}
                </select>
              </div>

              <div>
                <label style={{ ...styles.label, color: theme.textSecondary }}>ප්‍රමාණය (Quantity)</label>
                <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} style={{ ...styles.input, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border }} />
              </div>

              {user.role === "victim" && (
                <div>
                  <label style={{ ...styles.label, color: theme.textSecondary }}>අවශ්‍යතාවයේ තීව්‍රතාවය (Urgency)</label>
                  <select value={urgency} onChange={(e) => setUrgency(e.target.value)} style={{ ...styles.select, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border }}>
                    <option value="1">Low</option>
                    <option value="2">Medium</option>
                    <option value="3">High</option>
                  </select>
                </div>
              )}

              <div style={{ ...styles.locationBar, backgroundColor: theme.inputBg, borderColor: theme.border }}>
                <span style={{ fontSize: 12, color: theme.textSecondary }}>
                  📍 {pos[0].toFixed(4)}, {pos[1].toFixed(4)}
                </span>
                <button 
                  style={{ ...styles.btnGps, backgroundColor: isLive ? "#22c55e" : theme.border, color: isLive ? "#ffffff" : theme.textPrimary }} 
                  onClick={toggleLiveGps}
                >
                  {isLive ? "📡 Live GPS Active" : "📍 Enable Live GPS"}
                </button>
              </div>

              <button style={styles.btnPrimary} onClick={submit}>
                {user.role === "victim" ? "උදව් ඉල්ලීම යොමු කරන්න" : "සම්පත එකතු කරන්න"}
              </button>
            </div>
          </div>
        )}

        {/* 🔍 Search & Filter Controls Section */}
        <div style={{ ...styles.filterSection, backgroundColor: theme.formBg, borderColor: theme.border }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: theme.textPrimary, display: "flex", alignItems: "center", gap: 4 }}>
            🔍 Filter Requests
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input 
              type="text" 
              placeholder="Search by item or ID..." 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              style={{ ...styles.input, flex: 1, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border, fontSize: 13 }} 
            />
            <button 
              onClick={() => {}} 
              style={{ ...styles.btnPrimary, width: "auto", padding: "8px 12px", fontSize: 12 }}
            >
              🔍 Search
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={filterItem} onChange={(e) => setFilterItem(e.target.value)} style={{ ...styles.select, flex: 1, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border, fontSize: 12 }}>
              <option value="all">All Items</option>
              {ITEMS.map((i) => <option key={i} value={i}>{i.toUpperCase().replace("_", " ")}</option>)}
            </select>

            <select value={filterUrgency} onChange={(e) => setFilterUrgency(e.target.value)} style={{ ...styles.select, flex: 1, backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.border, fontSize: 12 }}>
              <option value="all">All Urgency</option>
              <option value="3">High</option>
              <option value="2">Medium</option>
              <option value="1">Low</option>
            </select>

            {(searchQuery || filterItem !== "all" || filterUrgency !== "all") && (
              <button 
                onClick={() => { setSearchQuery(""); setFilterItem("all"); setFilterUrgency("all"); }}
                style={{ ...styles.btnSecondary, backgroundColor: theme.inputBg, color: "#ef4444", borderColor: theme.border, width: "auto", padding: "6px 10px", fontSize: 11 }}
              >
                ✖ Reset
              </button>
            )}
          </div>
        </div>

        {/* Active Needs Feed List */}
        <div style={{ marginTop: 6, paddingBottom: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            Active Needs Feed 
            <span style={{ backgroundColor: theme.formBg, color: theme.textPrimary, padding: "2px 8px", borderRadius: 12, fontSize: 12 }}>
              {filteredNeeds.length} / {needs.length}
            </span>
          </h4>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredNeeds.map((n) => (
              <div key={n.id} style={{ ...styles.card, backgroundColor: theme.cardBg, borderColor: theme.border, borderLeft: `5px solid ${COLOR[n.status] || "#cbd5e1"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14, textTransform: "uppercase", color: theme.textPrimary }}>#{n.id} {n.item_type.replace("_", " ")}</span>
                    <span style={{ marginLeft: 6, fontSize: 13, color: theme.textSecondary }}>× {n.quantity}</span>
                  </div>
                  <span style={{ ...styles.badge, backgroundColor: URGENCY_COLOR[n.urgency] + "22", color: URGENCY_COLOR[n.urgency] }}>
                    {URGENCY_LABEL[n.urgency]}
                  </span>
                </div>

                <div style={{ marginTop: 6, fontSize: 12, color: theme.textSecondary, display: "flex", justifyContent: "space-between" }}>
                  <span>Status: <b style={{ color: COLOR[n.status] }}>{n.status}</b></span>
                </div>

                {user.role === "volunteer" && n.status === "requested" && (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${theme.border}` }}>
                    <button style={{ ...styles.btnSecondary, backgroundColor: theme.formBg, color: theme.textPrimary, borderColor: theme.border }} onClick={() => findMatches(n.id)}>🔍 Find nearby (5km)</button>

                    {(matches[n.id] || []).map((m) => (
                      <div key={m.id} style={{ ...styles.matchItem, backgroundColor: theme.formBg, color: theme.textPrimary }}>
                        <span>Resource #{m.id} ({m.quantity}) • <b>{(m.distance_m / 1000).toFixed(1)} km</b></span>
                        <button style={styles.btnSmall} onClick={() => accept(n.id, m.id)}>Accept</button>
                      </div>
                    ))}
                    {matches[n.id]?.length === 0 && <div style={{ fontSize: 12, color: theme.textSecondary, marginTop: 4 }}>ළඟපාත සම්පත් නැත</div>}
                  </div>
                )}

                {user.role === "volunteer" && n.status === "assigned" && (
                  <button style={{ ...styles.btnPrimary, backgroundColor: "#10b981", marginTop: 8 }} onClick={() => deliver(n.id)}>
                    ✓ Mark Delivered
                  </button>
                )}
              </div>
            ))}

            {filteredNeeds.length === 0 && (
              <div style={{ textAlign: "center", padding: 16, color: theme.textSecondary, fontSize: 13 }}>
                කිසිදු ඉල්ලීමක් හමු නොවීය. (No matching requests found)
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Interactive Map View */}
      <div style={{ flex: 1, width: "100%", height: isMobile ? "calc(100vh - 56px)" : "100vh" }}>
        <MapContainer 
          center={pos} 
          zoom={13} 
          style={{ 
            width: "100%", 
            height: "100%", 
            filter: darkMode ? "invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)" : "none" 
          }}
        >
          <TileLayer url={theme.mapTile} attribution="© OpenStreetMap" />
          <Picker onPick={(newPos) => { setIsLive(false); setPos(newPos); }} />
          <RecenterMap center={pos} />
          
          {/* Live Location Marker */}
          <CircleMarker center={pos} radius={12} pathOptions={{ color: "#2563eb", fillColor: "#3b82f6", fillOpacity: 0.9, weight: 3 }}>
            <Popup>📡 Your Live Location</Popup>
          </CircleMarker>
          <CircleMarker center={pos} radius={22} pathOptions={{ color: "#60a5fa", fillColor: "#93c5fd", fillOpacity: 0.3, weight: 1 }} />

          {/* Need Markers */}
          {filteredNeeds.map((n) => (
            <CircleMarker key={"n" + n.id} center={[n.lat, n.lng]} radius={10} pathOptions={{ color: COLOR[n.status], fillColor: COLOR[n.status], fillOpacity: 0.6 }}>
              <Popup>
                <div style={{ fontWeight: 700 }}>Need #{n.id}: {n.item_type.replace("_", " ")} × {n.quantity}</div>
                <div>Urgency: {URGENCY_LABEL[n.urgency]}</div>
                <div>Status: {n.status}</div>
              </Popup>
            </CircleMarker>
          ))}

          {/* Resource Markers */}
          {resources.map((r) => (
            <CircleMarker key={"r" + r.id} center={[r.lat, r.lng]} radius={8} pathOptions={{ color: COLOR.resource, fillColor: COLOR.resource, fillOpacity: 0.7 }}>
              <Popup>
                <div style={{ fontWeight: 700, color: "#0891b2" }}>Resource #{r.id}</div>
                <div>{r.item_type.replace("_", " ")} × {r.quantity}</div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

    </div>
  );
}

const styles = {
  loginContainer: {
    display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", width: "100vw", fontFamily: "'Inter', system-ui, sans-serif"
  },
  loginCard: {
    width: 340, padding: 28, borderRadius: 16, boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)", textAlign: "center", border: "1px solid"
  },
  loginTitle: { margin: 0, fontSize: 24, fontWeight: 800 },
  loginSubtitle: { margin: "4px 0 24px 0", fontSize: 13 },
  mobileHeader: {
    height: 56, padding: "0 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid", zIndex: 10000, position: "relative"
  },
  btnMenuToggle: {
    padding: "6px 12px", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer"
  },
  sidebar: {
    width: 380, padding: 20, overflowY: "auto", boxSizing: "border-box", borderRight: "1px solid", display: "flex", flexDirection: "column", gap: 14
  },
  userHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottom: "1px solid"
  },
  statsContainer: {
    display: "flex", gap: 8, padding: 10, borderRadius: 12, border: "1px solid", textAlign: "center"
  },
  statBox: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center"
  },
  btnLogout: {
    padding: "6px 12px", border: "1px solid", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600
  },
  btnTheme: {
    padding: "4px 10px", border: "1px solid", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700
  },
  alertBox: {
    backgroundColor: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 600
  },
  formCard: {
    padding: 14, borderRadius: 12, border: "1px solid"
  },
  filterSection: {
    padding: 12, borderRadius: 12, border: "1px solid"
  },
  card: {
    padding: 12, borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", border: "1px solid"
  },
  label: { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 },
  input: {
    width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid", fontSize: 14, boxSizing: "border-box", outline: "none"
  },
  select: {
    width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid", fontSize: 14, boxSizing: "border-box"
  },
  locationBar: {
    display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderRadius: 8, border: "1px solid"
  },
  btnGps: {
    padding: "6px 10px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, transition: "all 0.2s ease"
  },
  btnPrimary: {
    width: "100%", padding: "10px", backgroundColor: "#2563eb", color: "#ffffff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer"
  },
  btnSecondary: {
    width: "100%", padding: "6px 10px", border: "1px solid", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer"
  },
  btnSmall: {
    padding: "4px 8px", backgroundColor: "#2563eb", color: "#ffffff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer"
  },
  matchItem: {
    display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, padding: 6, borderRadius: 6, fontSize: 12
  },
  badge: {
    display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 800, textTransform: "uppercase"
  }
};