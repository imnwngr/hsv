import { useEffect, useRef, useState } from "react";

export function EditorNavigation({
  congratulation,
}: {
  congratulation: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState("basics");
  const sections = [
    ["basics", "Thông tin", ["basics", "appearance"]],
    ["content", "Nội dung & nhạc", ["content"]],
    [
      congratulation ? "agenda" : "time",
      congratulation ? "Chương trình" : "Lịch & địa điểm",
      congratulation ? ["agenda"] : ["time", "venue", "agenda"],
    ],
    ["guests", "Khách mời", ["guests"]],
    ["publish", "Thiệp hiển thị", ["publish"]],
    [
      congratulation ? "invitation-links" : "attendance",
      congratulation ? "Liên kết thiệp" : "Điểm danh",
      congratulation
        ? ["invitation-links"]
        : ["attendance", "invitation-links"],
    ],
  ] as const;
  const sectionKey = congratulation ? "congratulation" : "invitation";
  useEffect(() => {
    const nav = ref.current,
      link = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !link) return;
    const left = link.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft) nav.scrollLeft = left;
    else if (left + link.offsetWidth > nav.scrollLeft + nav.clientWidth)
      nav.scrollLeft = left + link.offsetWidth - nav.clientWidth;
  }, [active]);
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const header = document.querySelector<HTMLElement>(".site-header");
    const updateSize = () => {
      const height = header?.getBoundingClientRect().height ?? 0;
      document.documentElement.style.setProperty(
        "--editor-header-height",
        `${height}px`,
      );
      document.documentElement.style.setProperty(
        "--editor-scroll-offset",
        `${height + nav.getBoundingClientRect().height + 16}px`,
      );
    };
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(updateSize)
        : null;
    observer?.observe(nav);
    if (header) observer?.observe(header);
    window.addEventListener("resize", updateSize);
    updateSize();
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const offset = nav.getBoundingClientRect().bottom + 24;
        let current = sections[0][0] as string;
        let nearest = -Infinity;
        for (const [target, , ids] of sections) {
          for (const id of ids) {
            const element = document.getElementById(
              id === "invitation-links" ? id : `editor-${id}`,
            );
            const top = element?.getBoundingClientRect().top;
            if (top !== undefined && top <= offset && top > nearest) {
              current = target;
              nearest = top;
            }
          }
        }
        setActive(current);
      });
    };
    document.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
      document.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
      document.documentElement.style.removeProperty("--editor-header-height");
      document.documentElement.style.removeProperty("--editor-scroll-offset");
    };
    // Sections only change when the event type changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionKey]);
  return (
    <nav ref={ref} className="editor-nav" aria-label="Các phần của sự kiện">
      {sections.map(([id, label], index) => (
        <a
          key={id}
          href={`#${id === "invitation-links" ? id : `editor-${id}`}`}
          aria-current={active === id ? "location" : undefined}
          onClick={(e) => {
            const target = document.getElementById(
              id === "invitation-links" ? id : `editor-${id}`,
            );
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({ block: "start", behavior: "instant" });
            target.tabIndex = -1;
            target.focus({ preventScroll: true });
            setActive(id);
          }}
        >
          <span aria-hidden="true">0{index + 1}</span>
          {label}
        </a>
      ))}
    </nav>
  );
}
