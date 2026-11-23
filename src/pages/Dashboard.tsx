import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listEvents, deleteEvent } from "../features/events/api";
import {
  eventYear,
  filterEvents,
  formatDate,
  eventListDate,
  eventStatus,
  orderAdminEvents,
  typeLabel,
} from "../lib/domain";
import { errorMessage } from "../lib/supabase";
import { ErrorState, Loading } from "../components/Feedback";
import { EventFilters } from "../components/EventFilters";
import { EventSearch } from "../components/EventSearch";
import { Confirm } from "../components/Confirm";
import type { ClubEvent } from "../types/domain";
import { Plus, ArrowUpRight, CalendarDays, SearchX } from "lucide-react";
import { useClock } from "../hooks/useClock";
import { useEventListFilters } from "../hooks/useEventListFilters";
import { PublicationSwitch } from "../features/events/PublicationSwitch";
import { DuplicateEventButton } from "../features/events/DuplicateEventButton";
import { EventActions } from "../features/events/EventActions";
export default function Dashboard() {
  const now = useClock();
  const query = useQuery({
    queryKey: ["events", "admin"],
    queryFn: () => listEvents(true),
  });
  const cache = useQueryClient();
  const {
    search,
    setSearch,
    month,
    setMonth,
    year,
    setYear,
    view: status,
    setView: setStatus,
    clearFilters,
  } = useEventListFilters();
  const [deleting, setDeleting] = useState<ClubEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const events = query.data ?? [];
  const hasFilters = !!(search || month || year || status);
  const views = [
    { value: "", label: "Tất cả", count: events.length },
    {
      value: "published",
      label: "Đã công khai",
      count: events.filter((e) => e.status === "published").length,
    },
    {
      value: "draft",
      label: "Chưa công khai",
      count: events.filter((e) => e.status === "draft").length,
    },
    {
      value: "upcoming",
      label: "Sắp diễn ra",
      count: events.filter(
        (e) => e.status === "published" && eventStatus(e, now) === "upcoming",
      ).length,
    },
  ];
  const filtered = orderAdminEvents(
    filterEvents(events, month, year, search),
  ).filter(
    (e) =>
      !status ||
      (status === "upcoming"
        ? e.status === "published" && eventStatus(e, now) === "upcoming"
        : e.status === status),
  );
  return (
    <section className="admin event-dashboard">
      <div className="section-head">
        <div>
          <h1>Quản lý sự kiện</h1>
          <p className="dashboard-description">
            Nội dung, thiệp và điểm danh trong một nơi.
          </p>
        </div>
        <div className="actions">
          <Link className="button" to="/admin/new">
            <Plus size={18} aria-hidden="true" /> Thêm sự kiện
          </Link>
        </div>
      </div>
      {query.data && !query.error && (
        <div
          className="event-views"
          role="group"
          aria-label="Lọc trạng thái sự kiện"
        >
          {views.map((view) => (
            <button
              key={view.value}
              type="button"
              aria-pressed={status === view.value}
              onClick={() => setStatus(view.value)}
            >
              {view.label}
              <span className="view-count">{view.count}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className="event-toolbar"
        role="search"
        aria-label="Tìm và lọc sự kiện"
      >
        <EventSearch value={search} onChange={setSearch} />
        <EventFilters
          month={month}
          year={year}
          setMonth={setMonth}
          setYear={setYear}
          showReset={false}
          years={[...new Set(events.map((e) => eventYear(eventListDate(e))))]
            .sort()
            .reverse()}
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
            ? `${filtered.length} sự kiện${hasFilters ? " phù hợp" : " trong danh sách"}`
            : ""}
        </p>
        <p>
          Ngày bắt đầu: mới nhất trước
          <span className="filter-date-note">Thiệp chúc lọc theo ngày tạo</span>
        </p>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !filtered.length ? (
        <div className="state">
          <SearchX size={28} aria-hidden="true" />
          <h2>
            {hasFilters
              ? "Không tìm thấy sự kiện"
              : "Bắt đầu với sự kiện đầu tiên"}
          </h2>
          <p>
            {hasFilters
              ? "Thử tên, mã hoặc thời gian khác."
              : "Tạo nội dung, chọn người nhận rồi công khai khi đã sẵn sàng."}
          </p>
          {hasFilters ? (
            <button type="button" className="secondary" onClick={clearFilters}>
              Hiện tất cả sự kiện
            </button>
          ) : (
            <Link className="button" to="/admin/new">
              Thêm sự kiện đầu tiên
            </Link>
          )}
        </div>
      ) : (
        <div className="admin-list">
          {filtered.map((event) => (
            <article
              className="admin-event"
              key={event.id}
              data-event-code={event.code}
              aria-labelledby={`event-${event.id}`}
            >
              <div className="admin-event-content">
                <div className="admin-event-heading">
                  <span className="event-type-label">
                    {typeLabel(event.event_type)}
                  </span>
                  {event.duplicated_from_id && (
                    <span className="event-copy-label">Bản sao</span>
                  )}
                  {event.event_type !== "congratulation" &&
                    event.attendance_config?.enabled && (
                      <span className="event-attendance-label">
                        Có điểm danh
                      </span>
                    )}
                </div>
                <h2 className="event-title" id={`event-${event.id}`}>
                  <Link to={`/admin/edit/${event.code}`}>{event.title}</Link>
                </h2>
                <p className="admin-event-date">
                  <CalendarDays size={16} aria-hidden="true" />
                  <span>
                    {event.event_type === "congratulation"
                      ? "Ngày tạo: "
                      : !event.starts_at
                        ? "Chưa có lịch. Ngày tạo: "
                        : ""}
                    <time dateTime={eventListDate(event)}>
                      {formatDate(eventListDate(event))}
                    </time>
                  </span>
                </p>
                <p className="event-code">{event.code}</p>
              </div>
              <div className="admin-event-controls">
                <PublicationSwitch event={event} />
                <div className="admin-event-actions">
                  <Link
                    className="button secondary"
                    to={`/admin/edit/${event.code}`}
                  >
                    Chỉnh sửa
                    <span className="edit-invitations-label"> & thiệp</span>{" "}
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                  <DuplicateEventButton event={event} />
                  <EventActions
                    event={event}
                    onDelete={() => setDeleting(event)}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {deleting && (
        <Confirm
          title="Xóa sự kiện?"
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await deleteEvent(deleting.id);
              await cache.invalidateQueries();
              toast.success("Đã xóa sự kiện");
              setDeleting(null);
            } catch (error) {
              toast.error(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          Sự kiện “<span className="event-title">{deleting.title}</span>” và
          thiệp liên quan sẽ bị xóa. Danh bạ khách mời được giữ lại.
        </Confirm>
      )}
    </section>
  );
}
