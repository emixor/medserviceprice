"use client";

import type { Clinic } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { cityName, formatKzt } from "@/lib/format";
import { useI18n } from "@/components/providers";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import type { LatLngExpression, Map as LeafletMap } from "leaflet";
import { useEffect, useState } from "react";
import { Phone, Star, TrendingUp, BadgeCheck } from "lucide-react";

/** Custom div-icon (avoids bundling leaflet's marker image assets). */
function makeIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="msp-marker-pulse flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow-md" style="background:${color}">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

type ClinicWithStats = Clinic & {
  priceStats?: { count: number; min: number | null; max: number | null; avg: number | null };
};

export default function MapBlock({
  clinics,
  center,
  zoom,
  colorFor,
  onPick,
}: {
  clinics: ClinicWithStats[];
  center: LatLngExpression;
  zoom: number;
  colorFor: (c: ClinicWithStats) => string;
  onPick: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const [map, setMap] = useState<LeafletMap | null>(null);

  // Re-center when target changes (external state -> leaflet map sync)
  useEffect(() => {
    if (map) {
      map.setView(center, zoom, { animate: true });
    }
  }, [map, center, zoom]);

  return (
    <MapContainer center={center} zoom={zoom} scrollWheelZoom className="h-full w-full" ref={setMap}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {clinics.map((c) => (
        <Marker
          key={c.id}
          position={[c.latitude!, c.longitude!] as LatLngExpression}
          icon={makeIcon(colorFor(c), c.name.slice(0, 1).toUpperCase())}
        >
          <Popup>
            <div className="min-w-[200px] space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-1.5">
                <div className="font-bold leading-tight">{c.name}</div>
                {c.rating >= 4.5 && (
                  <span className="msp-verified inline-flex shrink-0" aria-hidden>
                    <BadgeCheck className="h-2.5 w-2.5" />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs">
                <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                <span className="font-semibold">{c.rating.toFixed(1)}</span>
                <span className="text-muted-foreground">· {cityName(c.city, lang)}</span>
              </div>
              <div className="text-xs text-muted-foreground">{c.address}</div>
              <div className="flex items-center gap-1 text-xs">
                <Phone className="h-2.5 w-2.5 text-primary" />
                <span className="tabular-nums">{c.phone}</span>
              </div>
              {c.priceStats && c.priceStats.count > 0 && (
                <div className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                  <TrendingUp className="h-2.5 w-2.5" />
                  <span>
                    {t("map.priceFrom", { price: formatKzt(c.priceStats.min!) })}
                    {" · "}
                    {t("map.clinicPrices", { count: c.priceStats.count })}
                  </span>
                </div>
              )}
              <button
                onClick={() => onPick(c.id)}
                className="mt-1 block w-full rounded-md bg-gradient-to-r from-primary to-cyan-600 px-2 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md [box-shadow:0_3px_8px_-2px_color-mix(in_oklch,var(--primary)_45%,transparent)]"
              >
                {t("result.viewClinic")}
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

