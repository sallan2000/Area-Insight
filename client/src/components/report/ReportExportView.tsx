import { Shield, Bus, GraduationCap, Store, ShoppingCart, ShoppingBag, Building2, AlertTriangle } from "lucide-react";

const BAR_COLORS: Record<string, string> = {
  "bg-red-500": "#ef4444",
  "bg-orange-500": "#f97316",
  "bg-amber-500": "#f59e0b",
  "bg-blue-500": "#3b82f6",
  "bg-gray-500": "#6b7280",
  "bg-slate-400": "#94a3b8",
};

const scoreHex = (s: number) => {
  if (s >= 80) return "#10b981";
  if (s >= 60) return "#3b82f6";
  if (s >= 40) return "#eab308";
  return "#ef4444";
};

const scoreLabel = (s: number) => {
  if (s >= 80) return "Outstanding";
  if (s >= 60) return "Good";
  if (s >= 40) return "Average";
  return "Poor";
};

function ExportScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const stroke = Math.max(5, size * 0.09);
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  const color = scoreHex(score);
  return (
    <div style={{ position: "relative", width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", position: "absolute" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e5e7eb" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: size * 0.24, fontWeight: 800, color, zIndex: 1 }}>{score}</span>
    </div>
  );
}

function SectionHeading({ Icon, title, score, unavailable }: { Icon: any; title: string; score: number; unavailable?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid #f3f4f6" }}>
      <div style={{ background: "#eff6ff", borderRadius: 8, padding: 7, display: "flex" }}>
        <Icon size={18} color="#2563eb" />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{title}</div>
        {unavailable ? (
          <div style={{ fontSize: 11, color: "#9ca3af" }}>Not scored — data unavailable</div>
        ) : (
          <div style={{ fontSize: 11, color: "#6b7280" }}>
            Score: <strong style={{ color: scoreHex(score) }}>{score}/100</strong> — {scoreLabel(score)}
          </div>
        )}
      </div>
      {!unavailable && <ExportScoreRing score={score} size={52} />}
    </div>
  );
}

function ItemGrid({ items, category }: { items: any[]; category: string }) {
  if (!items.length) return <p style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic", margin: 0 }}>No data available nearby</p>;
  // Ofsted rating → label + colour (rating 1=Outstanding … 4=Inadequate).
  const ofsted = (rating: number) => {
    const map: Record<number, { label: string; bg: string; fg: string; bd: string }> = {
      1: { label: "Outstanding", bg: "#dcfce7", fg: "#166534", bd: "#86efac" },
      2: { label: "Good", bg: "#dbeafe", fg: "#1e40af", bd: "#93c5fd" },
      3: { label: "Requires improvement", bg: "#fef3c7", fg: "#92400e", bd: "#fcd34d" },
      4: { label: "Inadequate", bg: "#fee2e2", fg: "#991b1b", bd: "#fca5a5" },
    };
    const b = map[rating];
    if (!b) return null;
    return (
      <span style={{ fontSize: 8, fontWeight: 600, background: b.bg, color: b.fg, border: `1px solid ${b.bd}`, borderRadius: 4, padding: "1px 5px", marginLeft: 4 }}>
        Ofsted: {b.label}
      </span>
    );
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
      {items.map((item: any, i: number) => (
        <div key={i} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 7, padding: "5px 9px" }}>
          <div style={{ fontWeight: 600, fontSize: 11, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.name}{item.rating != null && ofsted(item.rating)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase" }}>{(item.category || category).replace(/_/g, " ")}</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: "#2563eb" }}>{item.distance}km</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function OverpassWarning() {
  return (
    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 7, padding: "8px 12px", fontSize: 11, color: "#92400e", marginBottom: 10, display: "flex", gap: 6, alignItems: "flex-start" }}>
      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
      Map data temporarily unavailable — scores may be lower than usual.
    </div>
  );
}

export interface ReportExportViewProps {
  report: any;
  scores: any;
  raw: any;
  overallScore: number;
  safetyBreakdownItems: { label: string; value: number; color: string }[];
}

export function ReportExportView({ report, scores, raw, overallScore, safetyBreakdownItems }: ReportExportViewProps) {
  const safetyExcluded = !!(raw?.crimeDataUnavailable);

  const amenitiesByCategory = (raw.amenities?.list || []).reduce((acc: any, item: any) => {
    const cat = item.category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const dataDate = report.createdAt
    ? new Date(report.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", background: "#ffffff", padding: 40, width: 1100, color: "#111827", boxSizing: "border-box" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, paddingBottom: 20, borderBottom: "2px solid #e5e7eb" }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#6b7280", textTransform: "uppercase", marginBottom: 4 }}>ScoreMyStreet</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: "#111827", letterSpacing: -0.5, lineHeight: 1 }}>{report.postcode}</div>
          {(raw.street || raw.city) && (
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{[raw.street, raw.city].filter(Boolean).join(", ")}</div>
          )}
          {dataDate && (
            <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>Data as of {dataDate}</div>
          )}
        </div>
        <div style={{ textAlign: "center" }}>
          <ExportScoreRing score={overallScore} size={108} />
          <div style={{ fontSize: 13, fontWeight: 700, color: scoreHex(overallScore), marginTop: 6 }}>{scoreLabel(overallScore)}</div>
          <div style={{ fontSize: 10, color: "#9ca3af" }}>Liveability Score</div>
        </div>
      </div>

      {/* ── Category overview bar ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
        {[
          { label: "Transport", score: Math.round(scores.transport), Icon: Bus },
          { label: "Safety", score: Math.round(scores.safety), Icon: Shield, unavailable: safetyExcluded },
          { label: "Schools", score: Math.round(scores.schools), Icon: GraduationCap },
          { label: "Amenities", score: Math.round(scores.amenities), Icon: Store },
        ].map(({ label, score, Icon, unavailable }) => (
          <div key={label} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", textAlign: "center", opacity: unavailable ? 0.5 : 1 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
              <Icon size={20} color={scoreHex(score)} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: unavailable ? "#9ca3af" : scoreHex(score) }}>
              {unavailable ? "N/A" : score}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
            {unavailable && <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 2 }}>Not scored</div>}
          </div>
        ))}
      </div>

      {/* ── Safety ── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeading Icon={Shield} title="Safety" score={Math.round(scores.safety)} unavailable={safetyExcluded} />
        {safetyExcluded ? (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
            Police Scotland does not publish street-level crime data via the national police.uk API,
            and the SIMD crime proxy dataset is not loaded on this server. Safety is excluded from
            the liveability score for this Scottish postcode.
          </div>
        ) : raw?.safetySource === 'simd2020' && raw?.scottishSafety ? (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#1e40af" }}>
            <strong>SIMD 2020v2 Crime domain</strong> — Data Zone rank {raw.scottishSafety.crimeRank} of ~6,976
            {raw.scottishSafety.crimeRate != null ? ` (${raw.scottishSafety.crimeRate} crimes per 10,000 residents)` : ""}.
            <div style={{ fontSize: 10, color: "#1e40af", marginTop: 6 }}>
              Annual, small-area (≈700 people) Scottish Government statistics — not realtime street crime.
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: "#374151", marginBottom: 10 }}>
              <strong>{raw.crimeCount || 0}</strong> incidents reported in the last 12 months
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {safetyBreakdownItems.map((item) => (
                <div key={item.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                    <span style={{ color: "#374151" }}>{item.label}</span>
                    <span style={{ fontWeight: 600 }}>{item.value}</span>
                  </div>
                  <div style={{ background: "#e5e7eb", borderRadius: 999, height: 5, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, raw.crimeCount > 0 ? (item.value / raw.crimeCount) * 100 : 0)}%`, height: 5, background: BAR_COLORS[item.color] || "#9ca3af" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Transport ── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeading Icon={Bus} title="Transport" score={Math.round(scores.transport)} />
        {raw.overpassFailed && <OverpassWarning />}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Stations</div>
            <ItemGrid items={raw.transport?.stations || []} category="station" />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Bus Stops</div>
            <ItemGrid items={raw.transport?.busStops || []} category="bus_stop" />
          </div>
        </div>
      </div>

      {/* ── Schools ── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeading Icon={GraduationCap} title="Schools" score={Math.round(scores.schools)} />
        {raw.overpassFailed && <OverpassWarning />}
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#1e40af", marginBottom: 12 }}>
          {raw.schools?.count || 0} schools within reach — {raw.schools?.primaryCount || 0} primary, {raw.schools?.secondaryCount || 0} secondary
          {raw.schools?.avgDistanceKm != null ? ` (avg ${raw.schools.avgDistanceKm} km away)` : ""}.
          {raw.schools?.hasRealRatings
            ? " Ofsted ratings are included where available and nudge the score."
            : " Score reflects number, mix and proximity of schools; a comparable rating feed isn't published for this nation."}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Primary &amp; Nursery</div>
            <ItemGrid items={raw.schools?.primaryList || []} category="primary_school" />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Secondary &amp; Higher</div>
            <ItemGrid items={raw.schools?.secondaryList || []} category="secondary_school" />
          </div>
        </div>
      </div>

      {/* ── Amenities ── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeading Icon={Store} title="Amenities" score={Math.round(scores.amenities)} />
        {raw.overpassFailed && <OverpassWarning />}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          {Object.entries(amenitiesByCategory).map(([category, items]: [string, any]) => (
            <div key={category}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                {category.replace(/_/g, " ")}
              </div>
              <ItemGrid items={items} category={category} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ marginTop: 28, paddingTop: 14, borderTop: "1px solid #e5e7eb", fontSize: 9, color: "#9ca3af", textAlign: "center" }}>
        Generated by ScoreMyStreet · Data sourced from UK Police API, OpenStreetMap, DEFRA, Environment Agency &amp; Ofcom
        {dataDate && ` · ${dataDate}`}
        {raw?.confidence && (
          <div style={{ marginTop: 4 }}>
            Data confidence: <strong style={{ textTransform: "uppercase" }}>{raw.confidence.overall}</strong>
            {raw.confidence.flags.length > 0 ? ` — ${raw.confidence.flags.join(" ")}` : " — all components measured."}
          </div>
        )}
      </div>
    </div>
  );
}
