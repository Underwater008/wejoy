import {
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Minus,
  Plus,
  X
} from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatFen, secondsUntil } from "@wejoy/domain";

export function Price({ fen, className = "" }: { fen: number; className?: string }) {
  return <span className={className}>{formatFen(fen)}</span>;
}

export function Countdown({ deadline }: { deadline: string }) {
  const [seconds, setSeconds] = useState(() => secondsUntil(deadline));
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(secondsUntil(deadline)), 1_000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return <span className={seconds < 60 ? "countdown countdown--urgent" : "countdown"}>{minutes}:{remainder}</span>;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? "toggle--on" : ""}`}
      aria-pressed={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__thumb">{checked ? <Check size={12} /> : null}</span>
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function QuantityControl({
  value,
  onChange,
  disabled = false
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="quantity-control">
      <IconButton label="减少" disabled={disabled || value === 0} onClick={() => onChange(Math.max(0, value - 1))}>
        <Minus size={15} />
      </IconButton>
      <span aria-live="polite">{value}</span>
      <IconButton label="增加" disabled={disabled} onClick={() => onChange(value + 1)}>
        <Plus size={15} />
      </IconButton>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <IconButton label="关闭" onClick={onClose}><X size={19} /></IconButton>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body
  );
}

export function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">{icon}</span>
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function LoadingState({ label = "加载中" }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle size={20} className="spin" /> {label}</div>;
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <CircleAlert size={18} />
      <span>{message}</span>
      {onClose ? <IconButton label="关闭" onClick={onClose}><X size={16} /></IconButton> : null}
    </div>
  );
}

export function SelectField({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="select-wrap"><select {...props}>{children}</select><ChevronDown size={15} /></span>;
}
