import { useEffect, useRef } from 'react';

interface LockedMapProps {
  lat: number;
  lng: number;
  postcode: string;
}

declare global {
  interface Window {
    L: any;
  }
}

export function LockedMap({ lat, lng, postcode }: LockedMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const leafletLoaded = useRef(false);

  useEffect(() => {
    const loadLeaflet = async () => {
      if (leafletLoaded.current || !mapContainer.current) return;

      // Load Leaflet CSS
      if (!document.querySelector('link[href*="leaflet.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      // Load Leaflet JS
      if (!window.L) {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => {
          leafletLoaded.current = true;
          initMap();
        };
        document.head.appendChild(script);
      } else {
        leafletLoaded.current = true;
        initMap();
      }
    };

    const initMap = () => {
      if (!mapContainer.current || mapInstance.current) return;

      const map = window.L.map(mapContainer.current, {
        center: [lat, lng],
        zoom: 16,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomControl: true,
      });

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      window.L.marker([lat, lng], {
        title: postcode,
      }).addTo(map);

      mapInstance.current = map;
    };

    loadLeaflet();

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [lat, lng, postcode]);

  return (
    <div
      ref={mapContainer}
      className="w-full"
      style={{ height: '400px' }}
    />
  );
}
