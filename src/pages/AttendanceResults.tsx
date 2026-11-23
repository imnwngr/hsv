import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { attendanceCsv, attendanceResults } from "../features/attendance/api";
import { formatDate } from "../lib/domain";
import { ErrorState, Loading } from "../components/Feedback";
import "../styles/attendance.css";
export default function AttendanceResults() {
  const { eventCode = "" } = useParams();
  const query = useQuery({
    queryKey: ["attendance-results", eventCode],
    queryFn: () => attendanceResults(eventCode),
  });
  return (
    <section className="admin">
      <Link to={`/admin/edit/${eventCode}`}>Về chỉnh sửa sự kiện</Link>
      <h1>Kết quả điểm danh</h1>
      <div className="actions">
        <button
          className="secondary"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Tải lại kết quả
        </button>
        <button
          disabled={!query.data?.length}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([attendanceCsv(query.data ?? [])], {
                type: "text/csv;charset=utf-8",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `diem-danh-${eventCode}.csv`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Xuất CSV
        </button>
      </div>
      <p className="field-hint">
        Nhập CSV vào Google Sheets hoặc Excel. MSSV là văn bản; các mốc trong
        file dùng UTC và có múi giờ. Chỉ chia sẻ với người phụ trách điểm danh.
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !query.data?.length ? (
        <p>Chưa có lượt điểm danh.</p>
      ) : (
        <>
          <p role="status">{query.data.length} bản ghi</p>
          <div
            className="attendance-table-wrap"
            tabIndex={0}
            aria-label="Bảng kết quả, cuộn ngang để xem đủ cột"
          >
            <table className="attendance-table">
              <thead>
                <tr>
                  {[
                    "Họ tên",
                    "MSSV",
                    "Số đợt",
                    "Đợt 1",
                    "Đợt 2",
                    "Lịch sử sửa",
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.map((r) => (
                  <tr key={r.id}>
                    <td>{r.full_name}</td>
                    <td>{r.student_id}</td>
                    <td>{r.count}/2</td>
                    <td>
                      {r.round_one_at
                        ? formatDate(r.round_one_at)
                        : "Chưa ghi nhận"}
                    </td>
                    <td>
                      {r.round_two_at
                        ? formatDate(r.round_two_at)
                        : "Chưa ghi nhận"}
                    </td>
                    <td>
                      {r.history.length ? (
                        <details>
                          <summary>{r.history.length} lần sửa</summary>
                          <ul>
                            {r.history.map((h) => (
                              <li key={h.id}>
                                {formatDate(h.changed_at)}: {h.old_name} /{" "}
                                {h.old_student_id} → {h.new_name} /{" "}
                                {h.new_student_id}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        "Chưa sửa"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
