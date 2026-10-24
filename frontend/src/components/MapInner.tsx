"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { MapViewProps } from "./MapView";

const pinIcon = (color: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  });

function ClickHandler({ onClick }: { onClick?: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FitBounds({ points, version }: { points: [number, number][]; version?: string | number }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], Math.max(map.getZoom(), 17));
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 18 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, map]);
  return null;
}

export default function MapInner({ center, zoom = 16, markers = [], lines = [], onMapClick, fit, fitKey, height = 420 }: MapViewProps) {
  return (
    <MapContainer center={center} zoom={zoom} style={{ height, width: "100%" }} className="rounded-xl" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onClick={onMapClick} />
      {fit && <FitBounds points={fit} version={fitKey} />}
      {lines.map((l, i) => (
        <Polyline key={`l${i}`} positions={l.points} pathOptions={{ color: l.color, weight: l.weight ?? 5, dashArray: l.dashed ? "8 8" : undefined, opacity: 0.9 }}>
          {l.label && <Tooltip sticky>{l.label}</Tooltip>}
        </Polyline>
      ))}
      {markers.map((m) =>
        m.draggable ? (
          <Marker
            key={m.id}
            position={[m.lat, m.lon]}
            draggable
            icon={pinIcon(m.color)}
            eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); m.onDragEnd?.(p.lat, p.lng); } }}
          >
            {m.label && <Tooltip>{m.label}</Tooltip>}
            {m.popup && <Popup>{m.popup}</Popup>}
          </Marker>
        ) : (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lon]}
            radius={m.radius ?? 8}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: m.color, fillOpacity: 0.95 }}
            eventHandlers={m.onClick ? { click: m.onClick } : undefined}
          >
            {m.label && <Tooltip>{m.label}</Tooltip>}
            {m.popup && <Popup>{m.popup}</Popup>}
          </CircleMarker>
        ),
      )}
    </MapContainer>
  );
}
