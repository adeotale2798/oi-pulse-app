import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, RotateCcw } from "lucide-react";
import TabHideContextMenu from "./TabHideContextMenu";

/**
 * Progressive tab overflow: as width shrinks, trailing tabs move into a
 * trailing "More" dropdown one-by-one (never dump all tabs at once).
 *
 * Tabs are drag-and-drop reorderable when `onReorder` is provided.
 * Double-click favorites a tab to the first slot (`onFavorite`).
 * Alt+← / Alt+→ nudges the focused tab (`onMove`).
 *
 * More menu is portaled to document.body so parent overflow-hidden chrome
 * (tiles + tabs row) cannot clip it.
 */
export default function OverflowTabBar({
  tabs = [],
  value,
  onChange,
  onReorder,
  onFavorite,
  onMove,
  onResetLayout,
  onHideTab,
  hiddenTabs = [],
  onRestoreTab,
  savingPagePreferences = false,
  className = "",
  testId = "dashboard-tab-bar",
}) {
  const wrapRef = useRef(null);
  const measureRef = useRef(null);
  const moreMeasureRef = useRef(null);
  const moreBtnRef = useRef(null);
  const menuPanelRef = useRef(null);
  const hiddenPagesWrapRef = useRef(null);
  const hiddenPagesButtonRef = useRef(null);
  const hiddenPagesMenuRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hiddenMenuOpen, setHiddenMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [hiddenMenuPos, setHiddenMenuPos] = useState({ top: 0, left: 0 });
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  const skipClickRef = useRef(false);

  const canReorder = typeof onReorder === "function";
  const canFavorite = typeof onFavorite === "function";
  const canMove = typeof onMove === "function";
  const canCustomizePages = typeof onHideTab === "function" && typeof onRestoreTab === "function";
  const hasHiddenTabs = canCustomizePages && hiddenTabs.length > 0;

  const placeHiddenMenu = useCallback(() => {
    const button = hiddenPagesButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = 176;
    setHiddenMenuPos({
      top: Math.round(rect.bottom + 4),
      left: Math.round(Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))),
    });
  }, []);

  const placeMenu = useCallback(() => {
    const btn = moreBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = 176;
    const left = Math.min(
      Math.max(8, r.left),
      Math.max(8, window.innerWidth - width - 8),
    );
    setMenuPos({ top: Math.round(r.bottom + 4), left: Math.round(left) });
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      const t = e.target;
      if (moreBtnRef.current?.contains(t)) return;
      if (menuPanelRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!hiddenMenuOpen) return undefined;
    placeHiddenMenu();
    const onDoc = (event) => {
      if (hiddenPagesWrapRef.current?.contains(event.target)) return;
      if (hiddenPagesMenuRef.current?.contains(event.target)) return;
      setHiddenMenuOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setHiddenMenuOpen(false);
    };
    window.addEventListener("resize", placeHiddenMenu);
    window.addEventListener("scroll", placeHiddenMenu, true);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", placeHiddenMenu);
      window.removeEventListener("scroll", placeHiddenMenu, true);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [hiddenMenuOpen, placeHiddenMenu]);

  useEffect(() => {
    if (hiddenTabs.length === 0) setHiddenMenuOpen(false);
  }, [hiddenTabs.length]);

  const recalculate = useCallback(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure || !tabs.length) {
      setVisibleCount(tabs.length);
      return;
    }
    const avail = Math.max(0, wrap.clientWidth - (hasHiddenTabs ? 36 : 0));
    const moreW = moreMeasureRef.current?.offsetWidth || 88;
    const buttons = Array.from(measure.querySelectorAll("[data-tab-measure]"));
    if (!buttons.length) {
      setVisibleCount(tabs.length);
      return;
    }
    const widths = buttons.map((el) => el.offsetWidth);
    const gap = 4; // gap-1

    let total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);
    if (total <= avail) {
      setVisibleCount(tabs.length);
      return;
    }

    let count = tabs.length;
    while (count > 1) {
      count -= 1;
      const sum =
        widths.slice(0, count).reduce((a, b) => a + b, 0) +
        gap * Math.max(0, count - 1) +
        moreW +
        gap;
      if (sum <= avail) break;
    }
    setVisibleCount(Math.max(1, count));
  }, [tabs, hasHiddenTabs]);

  useLayoutEffect(() => {
    recalculate();
  }, [recalculate, tabs, value]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", recalculate);
      return () => window.removeEventListener("resize", recalculate);
    }
    const ro = new ResizeObserver(() => recalculate());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [recalculate]);

  useEffect(() => {
    setMenuOpen(false);
  }, [value]);

  useLayoutEffect(() => {
    if (!menuOpen) return undefined;
    placeMenu();
    const onReposition = () => placeMenu();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [menuOpen, placeMenu, visibleCount, tabs.length]);

  const visible = useMemo(() => tabs.slice(0, visibleCount), [tabs, visibleCount]);
  const overflow = useMemo(() => tabs.slice(visibleCount), [tabs, visibleCount]);
  const activeInOverflow = overflow.some((t) => t.v === value);

  const triggerCls = (active, id) => {
    const isOver = canReorder && overId === id && draggingId && draggingId !== id;
    const isDrag = canReorder && draggingId === id;
    return `rounded-none border-b-2 px-2.5 sm:px-3 py-2 text-[13px] sm:text-sm font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 focus-visible:ring-offset-1 ${
      canReorder ? "cursor-grab active:cursor-grabbing" : ""
    } ${isDrag ? "opacity-40" : ""} ${
      isOver
        ? "border-emerald-400 bg-emerald-50/80 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
        : active
          ? "border-emerald-500 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300 bg-transparent shadow-none"
          : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
    }`;
  };

  const onDragStart = (e, id) => {
    if (!canReorder) return;
    skipClickRef.current = false;
    setDraggingId(id);
    try {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    } catch {
      /* noop */
    }
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setOverId(null);
  };

  const onDragOverTab = (e, id) => {
    if (!canReorder || !draggingId) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {
      /* noop */
    }
    if (overId !== id) setOverId(id);
  };

  const onDropTab = (e, dropId) => {
    if (!canReorder) return;
    e.preventDefault();
    e.stopPropagation();
    let from = draggingId;
    try {
      from = e.dataTransfer.getData("text/plain") || from;
    } catch {
      /* noop */
    }
    setDraggingId(null);
    setOverId(null);
    if (from && dropId && from !== dropId) {
      skipClickRef.current = true;
      onReorder(from, dropId);
    }
  };

  const onTabClick = (id) => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    onChange?.(id);
  };

  const onTabDoubleClick = (e, id) => {
    if (!canFavorite) return;
    e.preventDefault();
    e.stopPropagation();
    skipClickRef.current = true;
    onFavorite(id);
    onChange?.(id);
  };

  const onTabKeyDown = (e, id) => {
    if (!canMove || !e.altKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    onMove(id, e.key === "ArrowLeft" ? -1 : 1);
  };

  const tipParts = [];
  if (canReorder) tipParts.push("Drag to reorder");
  if (canFavorite) tipParts.push("double-click to pin first");
  if (canMove) tipParts.push("Alt+←/→ to nudge");
  tipParts.push("click to open");
  if (canCustomizePages && tabs.length > 1) {
    tipParts.push("right-click, long-press, or Shift+F10 to hide");
  }
  const tabTitle = tipParts.join(" · ");

  return (
    <div ref={wrapRef} className={`relative min-w-0 flex-1 overflow-visible ${className}`} data-testid={testId}>
      <div className="h-0 overflow-hidden opacity-0 pointer-events-none" aria-hidden>
        <div ref={measureRef} className="inline-flex gap-1 whitespace-nowrap">
          {tabs.map((t) => (
            <span
              key={t.v}
              data-tab-measure
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-2 text-[13px] sm:text-sm font-medium"
            >
              {t.l}
            </span>
          ))}
          <span
            ref={moreMeasureRef}
            className="inline-flex items-center gap-1 px-2.5 py-2 text-[13px] sm:text-sm font-medium"
          >
            More <ChevronDown className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200/80 dark:border-slate-700/80 min-w-0 overflow-visible">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-visible"
          role="tablist"
          aria-label="Dashboard views — drag, double-click, or Alt+arrows to reorder; use page options to hide"
        >
          {visible.map((t) => (
            <TabHideContextMenu
              key={t.v}
              tabId={t.v}
              label={t.l}
              canHide={canCustomizePages && tabs.length > 1}
              disabled={savingPagePreferences}
              onHide={onHideTab}
              className="inline-flex shrink-0 items-center"
            >
              <button
                type="button"
                role="tab"
                aria-selected={t.v === value}
                data-testid={`tab-${t.v}`}
                draggable={canReorder}
                onDragStart={(e) => onDragStart(e, t.v)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => onDragOverTab(e, t.v)}
                onDragLeave={() => {
                  if (overId === t.v) setOverId(null);
                }}
                onDrop={(e) => onDropTab(e, t.v)}
                onClick={() => onTabClick(t.v)}
                onDoubleClick={(e) => onTabDoubleClick(e, t.v)}
                onKeyDown={(e) => onTabKeyDown(e, t.v)}
                title={tabTitle}
                className={triggerCls(t.v === value, t.v)}
              >
                {t.l}
              </button>
            </TabHideContextMenu>
          ))}

          {overflow.length > 0 && (
          <div className="relative shrink-0 z-20">
            <button
              ref={moreBtnRef}
              type="button"
              data-testid="tab-more"
              onClick={() => {
                setMenuOpen((v) => {
                  if (!v) placeMenu();
                  return !v;
                });
              }}
              className={`${triggerCls(activeInOverflow, "__more__")} inline-flex items-center gap-1 cursor-pointer`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={`${overflow.length} more page${overflow.length === 1 ? "" : "s"}`}
            >
              {activeInOverflow
                ? overflow.find((t) => t.v === value)?.l || "More"
                : "More"}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
            </button>
            {menuOpen && typeof document !== "undefined" && createPortal(
              <div
                ref={menuPanelRef}
                role="menu"
                data-testid="tab-more-menu"
                className="fixed z-[240] min-w-[11rem] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                style={{ top: menuPos.top, left: menuPos.left }}
              >
                {overflow.map((t) => (
                  <TabHideContextMenu
                    key={t.v}
                    tabId={t.v}
                    label={t.l}
                    canHide={canCustomizePages && tabs.length > 1}
                    disabled={savingPagePreferences}
                    onHide={onHideTab}
                    onHideComplete={() => setMenuOpen(false)}
                    className="flex items-center"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`tab-more-${t.v}`}
                      draggable={canReorder}
                      onDragStart={(e) => onDragStart(e, t.v)}
                      onDragEnd={onDragEnd}
                      onDragOver={(e) => onDragOverTab(e, t.v)}
                      onDrop={(e) => onDropTab(e, t.v)}
                      onClick={() => {
                        onTabClick(t.v);
                        setMenuOpen(false);
                      }}
                      onDoubleClick={(e) => {
                        onTabDoubleClick(e, t.v);
                        setMenuOpen(false);
                      }}
                      onKeyDown={(e) => onTabKeyDown(e, t.v)}
                      title={tabTitle}
                      className={`flex min-w-0 flex-1 items-center px-3 py-2 text-left text-sm ${
                        canReorder ? "cursor-grab active:cursor-grabbing" : ""
                      } ${draggingId === t.v ? "opacity-40" : ""} ${
                        overId === t.v && draggingId && draggingId !== t.v
                          ? "bg-emerald-50 dark:bg-emerald-950/40"
                          : ""
                      } ${
                        t.v === value
                          ? "bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                          : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                      }`}
                    >
                      {t.l}
                    </button>
                  </TabHideContextMenu>
                ))}
              </div>,
              document.body,
            )}
          </div>
          )}
        </div>

        {hasHiddenTabs && (
          <div ref={hiddenPagesWrapRef} className="relative z-30 shrink-0">
            <button
              ref={hiddenPagesButtonRef}
              type="button"
              data-testid="dashboard-add-page"
              aria-label="Add a hidden dashboard page"
              aria-expanded={hiddenMenuOpen}
              title="Restore a hidden dashboard page"
              disabled={savingPagePreferences}
              onClick={() => setHiddenMenuOpen((open) => !open)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-emerald-950/40"
            >
              <Plus className="h-4 w-4" />
            </button>
            {hiddenMenuOpen && typeof document !== "undefined" && createPortal(
              <div
                ref={hiddenPagesMenuRef}
                role="menu"
                data-testid="dashboard-hidden-pages-menu"
                className="fixed z-[240] min-w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                style={{ top: hiddenMenuPos.top, left: hiddenMenuPos.left }}
              >
                {hiddenTabs.map((tab) => (
                  <button
                    key={tab.v}
                    type="button"
                    role="menuitem"
                    data-testid={`dashboard-restore-${tab.v}`}
                    disabled={savingPagePreferences}
                    onClick={() => {
                      onRestoreTab(tab.v);
                      setHiddenMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5 text-emerald-600" />
                    {tab.l}
                  </button>
                ))}
              </div>,
              document.body,
            )}
          </div>
        )}

        {typeof onResetLayout === "function" && (
          <button
            type="button"
            data-testid="btn-reset-layout"
            onClick={onResetLayout}
            className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-transparent text-slate-400 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title="Reset tab order, tile order, and expiry list height"
            aria-label="Reset layout"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
