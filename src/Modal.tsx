import { useLayoutEffect, useRef, type ReactNode } from "react";

const openModals: HTMLElement[] = [];
const inertOwners = new WeakMap<HTMLElement, { count: number; original: boolean }>();
const focusableSelector = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length && !element.closest('[inert], [hidden]'));
}

/** One focus boundary per modal, including nested confirmations. */
export function Modal({ children, onClose, className = "modal-backdrop" }: {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const modal = root.current!;
    openModals.push(modal);
    const siblings: HTMLElement[] = [];
    for (let node: HTMLElement | null = modal; node?.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        const owner = inertOwners.get(sibling) ?? { count: 0, original: sibling.inert };
        owner.count++;
        inertOwners.set(sibling, owner);
        sibling.inert = true;
        siblings.push(sibling);
      }
    }
    const focusFirst = () => (modal.querySelector<HTMLElement>('[data-modal-initial]') ?? focusableWithin(modal)[0] ?? modal).focus();
    if (!modal.contains(document.activeElement)) focusFirst();
    const handleFocus = (event: FocusEvent) => {
      if (openModals[openModals.length - 1] === modal && !modal.contains(event.target as Node)) focusFirst();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== modal || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); close.current?.();
      } else if (event.key === "Tab") {
        const elements = focusableWithin(modal);
        const first = elements[0] ?? modal;
        const last = elements[elements.length - 1] ?? modal;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("focusin", handleFocus);
    return () => {
      openModals.splice(openModals.indexOf(modal), 1);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("focusin", handleFocus);
      for (const sibling of siblings) {
        const owner = inertOwners.get(sibling)!;
        if (--owner.count === 0) {
          sibling.inert = owner.original;
          inertOwners.delete(sibling);
        }
      }
      queueMicrotask(() => {
        const target = returnFocus.current;
        const top = openModals[openModals.length - 1];
        if (target?.isConnected && (!top || top.contains(target))) target.focus();
      });
    };
  }, []);

  return <div ref={root} className={className} tabIndex={-1} onMouseDown={event => {
    if (event.target === event.currentTarget) close.current?.();
  }}>{children}</div>;
}
