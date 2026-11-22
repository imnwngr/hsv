import { useEffect, useRef, useState } from "react";
import type { AttendanceConfig, LocationSource } from "./model";
import { locationSource } from "./model";
import { allowedMapsUrl, coordinatesFromMaps } from "./mapLinks";
import { db } from "../../lib/supabase";

const tileSize = 256;
function world(latitude: number, longitude: number, zoom: number) {
  const n = tileSize * 2 ** zoom;
  return {
    x: ((longitude + 180) / 360) * n,
    y:
      ((1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2) *
      n,
  };
}
function coordinate(x: number, y: number, zoom: number) {
  const n = tileSize * 2 ** zoom;
  return {
    longitude: (x / n) * 360 - 180,
    latitude:
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
  };
}
export default function PinPicker({
  value,
  source,
  onChange,
}: {
  value: AttendanceConfig;
  source: LocationSource;
  onChange: (value: AttendanceConfig) => void;
}) {
  const [zoom, setZoom] = useState(17);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState(source.venue_name || source.address);
  const [busy, setBusy] = useState(false);
  const lastSearch = useRef(-Infinity);
  const [results, setResults] = useState<
    { lat: string; lon: string; display_name: string }[]
  >([]);
  const [mapError, setMapError] = useState(false);
  const [resolved, setResolved] = useState<{
    url: string;
    latitude: number;
    longitude: number;
  } | null>(null);
  const suggestion =
    coordinatesFromMaps(source.maps_url) ??
    (source.location_method === "place" &&
    source.latitude !== null &&
    source.longitude !== null
      ? { latitude: source.latitude, longitude: source.longitude }
      : null) ??
    (resolved?.url === source.maps_url ? resolved : null);
  useEffect(() => {
    if (
      value.latitude !== null ||
      value.longitude !== null ||
      coordinatesFromMaps(source.maps_url) ||
      !allowedMapsUrl(source.maps_url)
    )
      return;
    let cancelled = false;
    void db()
      .functions.invoke("attendance-location", {
        body: { url: source.maps_url },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (
          error ||
          !Number.isFinite(data?.latitude) ||
          !Number.isFinite(data?.longitude)
        ) {
          setMessage(
            "Không xác định được địa điểm từ liên kết. Tìm địa điểm hoặc nhập tọa độ bên dưới.",
          );
          return;
        }
        setResolved({
          url: source.maps_url,
          latitude: data.latitude,
          longitude: data.longitude,
        });
      })
      .catch(() => {
        if (!cancelled)
          setMessage(
            "Không thể đọc liên kết lúc này. Tìm địa điểm hoặc nhập tọa độ bên dưới.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [source.maps_url, value.latitude, value.longitude]);
  const pin =
    value.latitude !== null || value.longitude !== null
      ? value.latitude !== null &&
        value.longitude !== null &&
        Number.isFinite(value.latitude) &&
        Number.isFinite(value.longitude) &&
        Math.abs(value.latitude) <= 85 &&
        Math.abs(value.longitude) <= 180
        ? { latitude: value.latitude, longitude: value.longitude }
        : null
      : suggestion;
  const point = pin ? world(pin.latitude, pin.longitude, zoom) : null;
  const move = (latitude: number, longitude: number) => {
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 85 &&
      Math.abs(longitude) <= 180
    )
      onChange({ ...value, latitude, longitude, pin_confirmed: false });
  };
  return (
    <div className="pin-picker">
      {!pin && (
        <p className="notice">
          Chưa xác định được địa điểm từ liên kết. Tìm địa điểm hoặc nhập tọa độ
          rồi xác nhận ghim.
        </p>
      )}
      {pin && (
        <p className="field-hint">
          {value.pin_confirmed && value.pin_source === locationSource(source)
            ? "Ghim đã được xác nhận."
            : "Ghim gợi ý chưa được xác nhận. Kiểm tra trên bản đồ trước khi dùng."}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={async () => {
            const known = coordinatesFromMaps(source.maps_url);
            if (known) {
              move(known.latitude, known.longitude);
              return;
            }
            setBusy(true);
            setMessage("");
            try {
              const { data, error } = await db().functions.invoke(
                "attendance-location",
                { body: { url: source.maps_url } },
              );
              if (
                error ||
                !Number.isFinite(data?.latitude) ||
                !Number.isFinite(data?.longitude)
              )
                throw Error();
              move(data.latitude, data.longitude);
            } catch {
              setMessage(
                "Không xác định được địa điểm từ liên kết. Tìm địa điểm hoặc nhập tọa độ bên dưới.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Lấy vị trí từ Google Maps
        </button>
      </div>
      <label>
        Tìm địa điểm
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          if (search.trim().length < 3) {
            setMessage("Nhập ít nhất 3 ký tự để tìm địa điểm.");
            return;
          }
          if (performance.now() - lastSearch.current < 1100) {
            setMessage("Chờ một giây rồi tìm lại.");
            return;
          }
          lastSearch.current = performance.now();
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=vn&q=${encodeURIComponent(search.trim())}`,
              { referrerPolicy: "strict-origin-when-cross-origin" },
            );
            if (!response.ok) throw Error();
            const data = await response.json();
            setResults(data);
            if (!data.length)
              setMessage(
                "Không tìm thấy địa điểm. Có thể nhập tọa độ để chọn ghim.",
              );
          } catch {
            setMessage("Không thể tìm kiếm lúc này. Thử lại hoặc nhập tọa độ.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Tìm trên bản đồ
      </button>
      <p role="status">{busy ? "Đang tìm địa điểm…" : message}</p>
      {results.length > 0 && (
        <ul className="pin-search-results">
          {results.map((r) => (
            <li key={r.lat + r.lon}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  move(Number(r.lat), Number(r.lon));
                  setResults([]);
                }}
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pin && point && (
        <>
          <div
            className="attendance-map"
            role="application"
            aria-label="Bản đồ chọn ghim, dùng phím mũi tên để di chuyển"
            tabIndex={0}
            onKeyDown={(e) => {
              const directions: Record<string, [number, number]> = {
                ArrowUp: [0, -12],
                ArrowDown: [0, 12],
                ArrowLeft: [-12, 0],
                ArrowRight: [12, 0],
              };
              const delta = directions[e.key];
              if (!delta) return;
              e.preventDefault();
              const p = coordinate(
                point.x + delta[0],
                point.y + delta[1],
                zoom,
              );
              move(p.latitude, p.longitude);
            }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const p = coordinate(
                point.x + e.clientX - r.left - r.width / 2,
                point.y + e.clientY - r.top - r.height / 2,
                zoom,
              );
              move(p.latitude, p.longitude);
            }}
          >
            {Array.from({ length: 25 }, (_, i) => {
              const x = Math.floor(point.x / tileSize) + (i % 5) - 2,
                y = Math.floor(point.y / tileSize) + Math.floor(i / 5) - 2;
              return (
                <img
                  key={`${zoom}-${x}-${y}`}
                  src={`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`}
                  alt=""
                  width={256}
                  height={256}
                  draggable={false}
                  onError={() => setMapError(true)}
                  style={{
                    left: `calc(50% + ${x * tileSize - point.x}px)`,
                    top: `calc(50% + ${y * tileSize - point.y}px)`,
                  }}
                />
              );
            })}
            <span
              className="pin-radius"
              style={{
                width:
                  (2 * value.radius_m) /
                  ((156543.03392 * Math.cos((pin.latitude * Math.PI) / 180)) /
                    2 ** zoom),
                aspectRatio: "1",
              }}
            />
            <span className="map-pin" aria-hidden="true">
              +
            </span>
          </div>
          {mapError && (
            <p role="alert">
              Không tải đủ nền bản đồ. Kiểm tra tọa độ và thử lại khi có mạng.
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={zoom >= 19}
              onClick={() => setZoom(zoom + 1)}
            >
              Phóng to
            </button>
            <button
              type="button"
              className="secondary"
              disabled={zoom <= 10}
              onClick={() => setZoom(zoom - 1)}
            >
              Thu nhỏ
            </button>
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              © OpenStreetMap
            </a>
          </div>
        </>
      )}
      <div className="attendance-fields">
        <label>
          Vĩ độ
          <input
            type="number"
            step="any"
            min={-85}
            max={85}
            value={value.latitude ?? pin?.latitude ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                latitude: e.target.value === "" ? null : e.target.valueAsNumber,
                pin_confirmed: false,
              })
            }
          />
        </label>
        <label>
          Kinh độ
          <input
            type="number"
            step="any"
            min={-180}
            max={180}
            value={value.longitude ?? pin?.longitude ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                longitude:
                  e.target.value === "" ? null : e.target.valueAsNumber,
                pin_confirmed: false,
              })
            }
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!pin}
        onClick={() =>
          pin &&
          onChange({
            ...value,
            ...pin,
            pin_confirmed: true,
            pin_source: locationSource(source),
          })
        }
      >
        Xác nhận ghim điểm danh
      </button>
      <p className="field-hint">
        Tọa độ điểm danh được lưu riêng. Liên kết địa điểm trên thiệp được giữ
        nguyên.
      </p>
    </div>
  );
}
