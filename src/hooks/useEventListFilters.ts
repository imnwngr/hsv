import { useSearchParams } from "react-router-dom";

// The list URL keeps its filters when a visitor returns from an event.
export function useEventListFilters() {
  const [params, setParams] = useSearchParams();
  function set(key: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      // The URL drives a controlled input; deferred navigation can drop fast keystrokes.
      { replace: true, preventScrollReset: true, flushSync: true },
    );
  }
  return {
    search: params.get("q") ?? "",
    month: params.get("month") ?? "",
    year: params.get("year") ?? "",
    view: params.get("view") ?? "",
    setSearch: (value: string) => set("q", value),
    setMonth: (value: string) => set("month", value),
    setYear: (value: string) => set("year", value),
    setView: (value: string) => set("view", value),
    clearFilters: () =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const key of ["q", "month", "year", "view"]) next.delete(key);
          return next;
        },
        { replace: true, preventScrollReset: true, flushSync: true },
      ),
  };
}
