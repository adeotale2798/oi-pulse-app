import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const LONG_PRESS_MS = 550;
const MENU_WIDTH = 176;
const MENU_HEIGHT = 44;

export default function TabHideContextMenu({
  tabId,
  label,
  canHide,
  disabled = false,
  onHide,
  onHideComplete,
  className = "",
  children,
}) {
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  const menuItemRef = useRef(null);
  const holdTimerRef = useRef(null);
  const suppressedClickTimerRef = useRef(null);
  const holdOriginRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [menuPosition, setMenuPosition] = useState(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdOriginRef.current = null;
  };

  const openMenu = (left, top) => {
    setMenuPosition({
      left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - MENU_WIDTH - 8)),
      top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - MENU_HEIGHT - 8)),
    });
  };

  const onContextMenu = (event) => {
    if (!canHide || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    clearHoldTimer();
    if (event.nativeEvent?.pointerType === "touch" || event.nativeEvent?.pointerType === "pen") {
      suppressClickRef.current = true;
    }
    openMenu(event.clientX, event.clientY);
  };

  const onPointerDown = (event) => {
    if (!canHide || disabled || (event.pointerType !== "touch" && event.pointerType !== "pen")) return;
    clearHoldTimer();
    holdOriginRef.current = { x: event.clientX, y: event.clientY };
    holdTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      // A long press exposes the same page action on touch without a permanent close control.
      openMenu(event.clientX, event.clientY);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event) => {
    const origin = holdOriginRef.current;
    if (!origin) return;
    if (Math.abs(event.clientX - origin.x) > 10 || Math.abs(event.clientY - origin.y) > 10) {
      clearHoldTimer();
    }
  };

  const onPointerUp = () => {
    clearHoldTimer();
    if (!suppressClickRef.current) return;
    suppressedClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressedClickTimerRef.current = null;
    }, 250);
  };

  const onKeyDown = (event) => {
    if (!canHide || disabled || !((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")) return;
    event.preventDefault();
    event.stopPropagation();
    clearHoldTimer();
    const rect = wrapperRef.current?.getBoundingClientRect();
    openMenu(rect?.left ?? 8, rect?.bottom ?? 8);
  };

  useEffect(() => {
    if (!menuPosition) return undefined;
    menuItemRef.current?.focus();
    const closeOnOutsidePointer = (event) => {
      if (menuRef.current?.contains(event.target) || wrapperRef.current?.contains(event.target)) return;
      setMenuPosition(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuPosition(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuPosition]);

  useEffect(() => () => {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    if (suppressedClickTimerRef.current) window.clearTimeout(suppressedClickTimerRef.current);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={className}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        clearHoldTimer();
        suppressClickRef.current = false;
      }}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        if (suppressedClickTimerRef.current) {
          window.clearTimeout(suppressedClickTimerRef.current);
          suppressedClickTimerRef.current = null;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={onKeyDown}
    >
      {children}
      {menuPosition && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          data-testid={`tab-hide-menu-${tabId}`}
          className="fixed z-[260] min-w-44 overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          style={menuPosition}
        >
          <button
            ref={menuItemRef}
            type="button"
            role="menuitem"
            data-testid={`tab-hide-action-${tabId}`}
            disabled={disabled}
            onClick={() => {
              setMenuPosition(null);
              onHide?.(tabId);
              onHideComplete?.();
            }}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm text-slate-700 outline-none hover:bg-emerald-50 focus:bg-emerald-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:bg-slate-800"
          >
            Hide {label}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
