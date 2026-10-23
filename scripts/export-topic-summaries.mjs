import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const baseUrl = (process.env.NEXT_PUBLIC_SPECTRUM_API_URL ?? "").replace(/\/$/, "");
const token = process.env.SPECTRUM_API_TOKEN;
const outputPath = resolve(process.env.TOPIC_SUMMARIES_OUTPUT ?? ".local/topic-summaries.json");
const pageSize = 25;
const maxPages = Number(process.env.TOPIC_SUMMARIES_MAX_PAGES ?? 100);

if (!baseUrl || !token) {
  console.error("Configure NEXT_PUBLIC_SPECTRUM_API_URL e SPECTRUM_API_TOKEN no ambiente. O token não será gravado no arquivo.");
  process.exit(1);
}

function findRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["topics", "items", "results", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    const nested = findRows(value);
    if (nested.length) return nested;
  }
  return [];
}

function paginationOf(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const meta = payload.pagination ?? payload.meta ?? {};
  return {
    page: Number(meta.page ?? payload.page ?? 1),
    totalPages: Number(meta.total_pages ?? meta.pages ?? payload.total_pages ?? 0),
  };
}

let pageCount = 0;
const summaries = [];
for (let page = 1; page <= maxPages; page += 1) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), search: "" });
  const response = await fetch(`${baseUrl}/notifications/admin/topics?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    console.error(`A API respondeu HTTP ${response.status} na página ${page}. Nenhum token ou corpo privado foi exibido.`);
    process.exit(1);
  }

  const payload = await response.json();
  const rows = findRows(payload);
  pageCount += 1;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const summary = row.summary ?? row.short_summary ?? row.description ?? "";
    summaries.push({
      id: row.id ?? row.topic_id ?? null,
      title: row.canonical_title ?? row.title ?? null,
      summary,
      sourceFields: {
        summary: row.summary ?? null,
        short_summary: row.short_summary ?? null,
        description: row.description ?? null,
      },
      summaryType: typeof summary,
      summaryCharacters: typeof summary === "string" ? Array.from(summary).length : null,
      summaryUtf16Length: typeof summary === "string" ? summary.length : null,
    });
  }

  const { totalPages } = paginationOf(payload);
  if (totalPages > 0 ? page >= totalPages : rows.length < pageSize) break;
  if (page === maxPages) {
    console.error(`Interrompido no limite de ${maxPages} páginas. Ajuste TOPIC_SUMMARIES_MAX_PAGES se necessário.`);
    process.exit(1);
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  exportedAt: new Date().toISOString(),
  endpoint: "/notifications/admin/topics",
  pageCount,
  topicCount: summaries.length,
  summaries,
}, null, 2)}\n`, { mode: 0o600 });
console.log(`Exportados ${summaries.length} sumários de ${pageCount} páginas para ${outputPath}`);
console.log("O JSON inclui os campos de sumário exatamente como recebidos da API e não inclui o token.");
