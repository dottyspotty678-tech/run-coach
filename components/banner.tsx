import Link from "next/link";
import { IconAlert } from "@/components/icons";

type BannerProps = {
  variant?: "info" | "warn" | "error" | "ok";
  children: React.ReactNode;
  href?: string;
  linkLabel?: string;
};

const STYLES: Record<NonNullable<BannerProps["variant"]>, React.CSSProperties> = {
  info: { color: "var(--accent)", background: "var(--accent-soft)" },
  warn: { color: "var(--warn)", background: "var(--warn-soft)" },
  error: { color: "var(--danger)", background: "var(--danger-soft)" },
  ok: { color: "var(--ok)", background: "var(--ok-soft)" },
};

export function Banner({ variant = "info", children, href, linkLabel }: BannerProps) {
  const body = (
    <div
      className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium"
      style={STYLES[variant]}
    >
      {variant !== "info" && variant !== "ok" && (
        <IconAlert size={16} className="shrink-0" />
      )}
      <span className="min-w-0 flex-1">{children}</span>
      {href && linkLabel && <span className="shrink-0 underline underline-offset-2">{linkLabel}</span>}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }
  return body;
}
