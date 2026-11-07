"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/sessions", label: "Занятия" },
  { href: "/sessions/new", label: "Новое занятие" },
  { href: "/settings", label: "Настройки" },
];

type Theme = "light" | "dark";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* хранилище недоступно */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function TopBar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // Тема известна только в браузере; до этого кнопка не показывает состояние.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* без сохранения */
    }
  }

  const active = (href: string) =>
    href === "/sessions" ? pathname === "/sessions" || /^\/sessions\/(?!new)/.test(pathname) : pathname === href;

  return (
    <header className="topbar">
      <Link href="/sessions" className="brand">
        English Interview Analyst
      </Link>
      <nav className="nav" aria-label="Разделы">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>
      <button type="button" onClick={toggle} aria-label="Переключить тему">
        {theme === "dark" ? "Светлая тема" : theme === "light" ? "Тёмная тема" : "Тема"}
      </button>
    </header>
  );
}
