import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listEvents } from "../features/events/api";
import {
  eventStatus,
  eventPath,
  eventListDate,
  eventYear,
  filterEvents,
  formatDate,
  orderEvents,
  statusLabels,
} from "../lib/domain";
import { useClock } from "../hooks/useClock";
import { useEventListFilters } from "../hooks/useEventListFilters";
import { ErrorState, Loading } from "../components/Feedback";
import { EventFilters } from "../components/EventFilters";
import { EventSearch } from "../components/EventSearch";
import { ArrowDown, ArrowUpRight, SearchX } from "lucide-react";
import { PaperArt } from "../components/PaperArt";
export default function Home() {
  const query = useQuery({
    queryKey: ["events", "public"],
    queryFn: () => listEvents(),
  });
  const {
    month,
    setMonth,
    year,
    setYear,
    search,
    setSearch,
    view,
    setView,
    clearFilters: resetFilters,
  } = useEventListFilters();
  const [limit, setLimit] = useState(10);
  const now = useClock();
  const events = (query.data ?? []).filter(
    (event) => event.status === "published",
  );
  const hasFilters = !!(search || month || year || view);
  const filtered = orderEvents(
    filterEvents(events, month, year, search),
    now,
  ).filter((event) => {
    const status = eventStatus(event, now);
    return (
      !view ||
      (view === "upcoming"
        ? status === "upcoming" || status === "ongoing"
        : status === view)
    );
  });
  function clearFilters() {
    resetFilters();
    setLimit(10);
  }
  const years = [...new Set(events.map((e) => eventYear(eventListDate(e))))]
    .sort()
    .reverse();
  return (
    <>
      <section className="editorial-hero">
        <div className="hero-copy">
          <p className="section-label">Sự kiện Hội Sinh viên CTUT</p>
          <h1>
            Cùng nhau
            <br />
            <span>tạo nên</span>
            <br />
            dấu ấn.
          </h1>
          <p className="hero-description">
            Nền tảng sự kiện của Hội Sinh viên Trường Đại học Kỹ thuật – Công
            nghệ Cần Thơ. Theo dõi hoạt động và lưu giữ những khoảnh khắc đáng
            nhớ.
          </p>
          <a className="button hero-cta" href="#events-title">
            Xem sự kiện <ArrowDown size={18} aria-hidden="true" />
          </a>
        </div>
        <PaperArt />
        <div className="hero-colophon">
          <span>Kết nối sinh viên. Cùng nhau trưởng thành.</span>
          <a href="#events-title" aria-label="Cuộn đến danh sách sự kiện">
            <ArrowDown size={18} />
          </a>
        </div>
      </section>
      <section className="listing" aria-labelledby="events-title">
        <div className="section-head">
          <div>
            <p className="section-label">Hoạt động & dấu ấn</p>
            <h2 id="events-title" tabIndex={-1}>
              Sự kiện
            </h2>
          </div>
          <p className="listing-description">
            Tìm một hoạt động. Mở một lời mời.
          </p>
        </div>
        <div
          className="event-views"
          role="group"
          aria-label="Lọc sự kiện công khai"
        >
          {[
            { value: "", label: "Tất cả" },
            { value: "upcoming", label: "Sắp & đang diễn ra" },
            { value: "congratulation", label: "Thiệp chúc" },
            { value: "ended", label: "Đã kết thúc" },
          ].map((item) => (
            <button
              type="button"
              key={item.value}
              aria-pressed={view === item.value}
              onClick={() => {
                setView(item.value);
                setLimit(10);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          className="event-toolbar"
          role="search"
          aria-label="Tìm và lọc sự kiện"
        >
          <EventSearch
            value={search}
            onChange={(value) => {
              setSearch(value);
              setLimit(10);
            }}
          />
          <EventFilters
            month={month}
            year={year}
            setMonth={(v) => {
              setMonth(v);
              setLimit(10);
            }}
            setYear={(v) => {
              setYear(v);
              setLimit(10);
            }}
            years={years}
            showReset={false}
          />
          {hasFilters && (
            <button
              type="button"
              className="secondary filter-reset"
              onClick={clearFilters}
            >
              Xóa bộ lọc
            </button>
          )}
        </div>
        <div className="list-context">
          <p className="result-count" role="status">
            {!query.isPending && !query.error
              ? `${filtered.length} sự kiện${hasFilters ? " phù hợp với bộ lọc" : " được công bố"}`
              : ""}
          </p>
          <p>Thiệp mời theo ngày diễn ra; thiệp chúc theo ngày tạo.</p>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : !filtered.length ? (
          <div className="state">
            <SearchX size={28} aria-hidden="true" />
            <h3>
              {hasFilters
                ? "Không tìm thấy sự kiện"
                : "Chưa có sự kiện công khai"}
            </h3>
            <p>
              {hasFilters
                ? "Thử tên, mã hoặc thời gian khác để tìm sự kiện bạn cần."
                : "Các hoạt động mới sẽ xuất hiện tại đây khi được công bố."}
            </p>
            {hasFilters && (
              <button
                type="button"
                className="secondary"
                onClick={clearFilters}
              >
                Hiện tất cả sự kiện
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="event-list">
              {filtered.slice(0, limit).map((e, i) => (
                <article
                  key={e.id}
                  className={`event-row ${eventStatus(e, now) !== "ended" && i === 0 ? "featured" : ""}`}
                >
                  <div
                    className={`date-block${e.event_type === "congratulation" ? " congratulation-mark" : ""}`}
                  >
                    {e.event_type === "congratulation" ? (
                      <>
                        <strong>Chúc</strong>
                        <span>mừng</span>
                      </>
                    ) : (
                      <>
                        <strong>
                          {new Intl.DateTimeFormat("vi", {
                            timeZone: "Asia/Ho_Chi_Minh",
                            day: "2-digit",
                          }).format(new Date(eventListDate(e)))}
                        </strong>
                        <span>
                          {new Intl.DateTimeFormat("vi", {
                            timeZone: "Asia/Ho_Chi_Minh",
                            month: "long",
                            year: "numeric",
                          }).format(new Date(eventListDate(e)))}
                        </span>
                      </>
                    )}
                  </div>
                  <div>
                    <span className={`status ${eventStatus(e, now)}`}>
                      {statusLabels[eventStatus(e, now)]}
                    </span>
                    <h3 className="event-title">
                      <Link to={eventPath(e.code, e.event_type)}>
                        {e.title}
                      </Link>
                    </h3>
                    <p>
                      {e.event_type === "congratulation" ? "Ngày tạo: " : ""}
                      {formatDate(eventListDate(e))}
                    </p>
                    {e.event_type !== "congratulation" && (
                      <p>
                        {e.venue_name ||
                          e.address ||
                          "Địa điểm sẽ được thông báo"}
                      </p>
                    )}
                  </div>
                  <Link
                    className="text-link"
                    to={eventPath(e.code, e.event_type)}
                  >
                    Xem chi tiết<span className="sr-only"> {e.title}</span>
                    <ArrowUpRight size={20} aria-hidden="true" />
                  </Link>
                </article>
              ))}
            </div>
            {filtered.length > limit && (
              <button
                className="secondary load-more"
                onClick={() => setLimit((v) => v + 10)}
              >
                Xem thêm sự kiện
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}
