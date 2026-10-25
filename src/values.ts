import type { SocialLink } from "./types";
import { z } from "zod";
import { parseHTML } from "linkedom";

const EmailSchema = z.string().email();

export function isRecord(value: unknown): value is Record<string, unknown> {
 return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function text(value: unknown): string | undefined {
 if (typeof value !== "string") return undefined;
 const collapsed = value.replace(/\s+/g, " ").trim();
 return collapsed || undefined;
}

/**
 * Person names come from bylines and metadata that often carry a leading
 * "By"/"Written by" label. Keep the display name only; never invent one.
 */
export function personName(value: unknown): string | undefined {
 const cleaned = text(stripHtml(value))?.replace(/^(?:written\s+by|by)\s+/i, "").trim();
 return cleaned && cleaned.length >= 2 && cleaned.length <= 120 ? cleaned : undefined;
}
export function isAuthorProfileUrl(value: string): boolean {
 try {
  const parts = new URL(value).pathname.split("/").filter(Boolean);
  const last = parts.at(-1)?.toLowerCase();
  const parent = parts.at(-2)?.toLowerCase();
  if (parent === "profile") return parts.length === 2 && !!last && !/^(?:edit|settings|login|signup|search)$/i.test(last);
  if (parts[0]?.toLowerCase() === "people" && parts.length === 3 && /^\d+$/.test(parts[1]!) && !!last) {
   return !/^(?:edit|settings|login|signup|search)$/i.test(last);
  }
  return parts.length > 1 && /^(?:author|authors|contributor|contributors|staff|people)$/i.test(parent ?? "");
 } catch {
  return false;
 }
}

export function httpUrl(value: unknown, baseUrl: string): string | undefined {
 const raw = text(value);
 if (!raw) return undefined;
 if (/^https?:/i.test(raw) && !/^https?:\/\/[^/?#]+(?:[/?#]|$)/i.test(raw)) return undefined;
 try {
  const url = new URL(raw, baseUrl);
  return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
   ? url.href : undefined;
 } catch {
  return undefined;
 }
}

export function dateString(value: unknown): string | undefined {
 let date: Date | undefined;
 if (typeof value === "number") {
  date = numericDate(value);
 } else if (typeof value === "string") {
  const raw = value.trim();
  if (!raw) return undefined;
  if (/^\d{8}$/.test(raw)) date = compactDate(raw);
  else if (/^\d{9,13}$/.test(raw)) date = numericDate(Number(raw));
  else {
   const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(raw);
   if (calendar && !compactDate(`${calendar[1]}${calendar[2]}${calendar[3]}`)) return undefined;
   date = new Date(raw);
  }
 }
 if (!date || !Number.isFinite(date.getTime())) return undefined;
 const year = date.getUTCFullYear();
 return year >= 1900 && year <= 2200 ? date.toISOString() : undefined;
}

function compactDate(raw: string): Date | undefined {
 const year = Number(raw.slice(0, 4));
 const month = Number(raw.slice(4, 6));
 const day = Number(raw.slice(6, 8));
 if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
 const date = new Date(Date.UTC(year, month - 1, day));
 return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
}

function numericDate(value: number): Date | undefined {
 if (!Number.isFinite(value)) return undefined;
 if (Number.isInteger(value) && value >= 19000101 && value <= 29991231) return compactDate(String(value));
 // Unix seconds (10 digits) vs milliseconds (13 digits); small values are milliseconds.
 const milliseconds = value >= 1e12 ? value : value >= 1e9 ? value * 1000 : value;
 return new Date(milliseconds);
}

export function imageUrl(value: unknown, baseUrl: string): string | undefined {
 const pending: unknown[] = [value];
 for (let index = 0; index < pending.length && index < 32; index++) {
  const current = pending[index];
  if (Array.isArray(current)) {
   for (let i = 0; i < current.length && i < 10; i++) pending.push(current[i]);
   continue;
  }
  const result = httpUrl(isRecord(current) ? current.url ?? current.contentUrl ?? current["@id"] : current, baseUrl);
  if (result) return result;
 }
 return undefined;
}

export function emailAddress(value: unknown): string | undefined {
 const raw = text(value)?.replace(/^mailto:/i, "").split("?")[0];
 if (!raw) return undefined;
 let email: string;
 try { email = decodeURIComponent(raw).trim().toLowerCase(); } catch { return undefined; }
 if (!EmailSchema.safeParse(email).success) return undefined;
 if (/^(?:pitches|feedback|corrections|tips|press|contact|info|support|advertising|subscriptions|privacy|help|news|newsroom|desk|editorial)@/i.test(email)) return undefined;
 return email;
}

export function socialLink(value: unknown, baseUrl: string): SocialLink | undefined {
 const absolute = httpUrl(value, baseUrl);
 if (!absolute) return undefined;
 const url = new URL(absolute);
 const host = url.hostname.toLowerCase().replace(/^(?:www\.|mobile\.|m\.)/, "");
 const parts = url.pathname.split("/").filter(Boolean);
 const first = parts[0]?.toLowerCase();
 if (!first) return undefined;
 let platform: SocialLink["platform"];
 let personal = true;
 let handle: string | undefined;
 if (host === "linkedin.com") {
  platform = "linkedin";
  if (!["in", "company"].includes(first) || !parts[1] || parts.length !== 2) return undefined;
  personal = first === "in";
  handle = parts[1];
 } else if (host === "twitter.com" || host === "x.com") {
  platform = "twitter";
  if (parts.length !== 1 || /^(?:intent|share|search|home|i|login|signup|settings|explore|messages|notifications)$/i.test(first)) return undefined;
  handle = parts[0];
 } else if (host === "instagram.com") {
  platform = "instagram";
  if (parts.length !== 1 || /^(?:p|reel|reels|stories|explore|accounts|direct|about|share)$/i.test(first)) return undefined;
  handle = parts[0];
 } else if (host === "muckrack.com") {
  platform = "muckrack";
  if (parts.length !== 1 || /^(?:media-outlet|search|rankings|daily)$/i.test(first)) return undefined;
  handle = parts[0];
 } else if (host === "threads.net" || host === "threads.com") {
  platform = "threads";
  if (!first.startsWith("@") || parts.length !== 1) return undefined;
  handle = parts[0].slice(1);
 } else if (host === "bsky.app") {
  platform = "bluesky";
  if (first !== "profile" || !parts[1] || parts.length !== 2) return undefined;
  handle = parts[1];
 } else if (host === "github.com") {
  platform = "github";
  if (parts.length !== 1 || /^(?:login|signup|features|topics|explore|settings)$/i.test(first)) return undefined;
  handle = parts[0];
 } else if (host === "youtube.com") {
  platform = "youtube";
  if (!first.startsWith("@") && !(["user", "c", "channel"].includes(first) && parts[1])) return undefined;
  personal = first !== "channel";
  handle = first.startsWith("@") ? parts[0].slice(1) : parts[1];
 } else if (host === "facebook.com") {
  platform = "facebook";
  if (parts.length !== 1 || /^(?:sharer|sharer.php|share.php|dialog|plugins|login|watch)$/i.test(first)) return undefined;
  handle = parts[0];
 } else return undefined;
 url.hash = "";
 url.search = "";
 url.pathname = url.pathname.replace(/\/+$/, "");
 return { platform, url: url.href, isPersonal: personal, ...(handle ? { handle } : {}) };
}



const CHARACTER_REFERENCE = /&(?:#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/i;

export function decodeEntities(value: string): string {
 if (!CHARACTER_REFERENCE.test(value)) return value;
 const escaped = value.replace(/</g, "&lt;");
 const { document } = parseHTML(`<span>${escaped}</span>`);
 return document.querySelector("span")?.textContent ?? value;
}

export function stripHtml(value: unknown): string | undefined {
 if (typeof value !== "string") return undefined;
 const decoded = decodeEntities(value);
 return text(decoded.replace(/<[^>]*>/g, " "));
}
