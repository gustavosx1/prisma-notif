"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import prismaLogo from "../../assets/logo.png";
import gustaPhoto from "../../assets/foto-gusta.png";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Topic = { id: string; title: string; summary: string; publishedAt: string | null; articleCount: number };
type ImageEntityType = "public_figure" | "institution" | "topic";
type ImageAsset = { id: string; displayName: string; imageUrl: string; entityKey: string; attribution: string | null; licenseName: string };
type DispatchStatus = { id: string; state: string; accepted: number | null; rejected: number | null; receipts: string | null; error: string | null };
type DispatchRequest = { topicId: string; title: string; body: string; idempotencyKey: string };
type AdminAccess = "checking" | "allowed" | "denied" | "error";
const PAGE_SIZE = 25;
const TITLE_LIMIT = Number(process.env.NEXT_PUBLIC_NOTIFICATION_TITLE_LIMIT ?? 120);
const BODY_LIMIT = Number(process.env.NEXT_PUBLIC_NOTIFICATION_BODY_LIMIT ?? 240);
const TERMINAL_STATES = new Set(["sent", "failed"]);
const IMAGE_CATEGORIES: { id: ImageEntityType; label: string }[] = [
  { id: "public_figure", label: "Figuras públicas" },
  { id: "institution", label: "Instituições" },
  { id: "topic", label: "Temas" },
];
const MOTIVATIONAL_QUOTES = [
  "Cada grande conquista começa com a decisão de tentar.",
  "Seu trabalho de hoje constrói as oportunidades de amanhã.",
  "Consistência transforma pequenos passos em grandes resultados.",
  "Confie no processo: progresso também é vitória.",
  "Você é capaz de mais do que imagina.",
  "Grandes ideias ganham força quando colocadas em prática.",
  "Aprender no caminho também faz parte da chegada.",
  "Um passo de cada vez ainda é avanço.",
  "Seu esforço de hoje é o orgulho de amanhã.",
  "Continue: a próxima tentativa pode mudar tudo.",
];
const TITLE_SUGGESTIONS = [
  "🔎 Saiba mais",
  "Veja todas as perspectivas",
  "📰 Entenda o que está acontecendo",
  "Confira os principais detalhes",
  "📌 Veja o que muda agora",
  "Acompanhe essa história",
  "💡 O que você precisa saber",
  "Leia a análise completa",
  "🧭 Descubra os próximos passos",
  "Veja os pontos essenciais",
];

function apiBaseUrl() { return (process.env.NEXT_PUBLIC_SPECTRUM_API_URL ?? "").replace(/\/$/, ""); }
function numberOrNull(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function readTopicPage(payload: Record<string, unknown>, requestedPage: number) {
  const meta = (payload.pagination ?? payload.meta ?? {}) as Record<string, unknown>;
  const rows = [payload.topics, payload.items, payload.results, payload.data].find(Array.isArray) as unknown[] | undefined;
  const topics: Topic[] = (rows ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return { id: String(row.id ?? row.topic_id ?? ""), title: String(row.canonical_title ?? row.title ?? "Sem título"), summary: String(row.summary ?? row.short_summary ?? row.description ?? ""), publishedAt: (row.created_at ?? row.createdAt ?? row.published_at ?? row.publishedAt ?? row.date ?? null) as string | null, articleCount: Number(row.article_count ?? row.articles_count ?? row.articleCount ?? 0) };
  }).filter((topic) => topic.id);
  const total = Number(meta.total ?? meta.total_items ?? payload.total ?? topics.length);
  const pageSize = Number(meta.page_size ?? meta.per_page ?? payload.page_size ?? PAGE_SIZE);
  return { topics, page: Number(meta.page ?? payload.page ?? requestedPage), totalPages: Number(meta.total_pages ?? meta.pages ?? payload.total_pages ?? Math.max(1, Math.ceil(total / pageSize))), total };
}
function readImageAssets(payload: unknown): ImageAsset[] {
  function findRows(value: unknown, depth = 0): unknown[] {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object" || depth >= 3) return [];
    const object = value as Record<string, unknown>;
    for (const key of ["assets", "images", "items", "results", "data"]) {
      const candidate = object[key];
      if (Array.isArray(candidate)) return candidate;
      const nested = findRows(candidate, depth + 1);
      if (nested.length) return nested;
    }
    return [];
  }
  return findRows(payload).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id ?? row.entity_key ?? row.image_url ?? row.imageUrl ?? ""),
      displayName: String(row.display_name ?? row.displayName ?? row.entity_key ?? row.name ?? "Imagem sem nome"),
      imageUrl: String(row.image_url ?? row.imageUrl ?? ""),
      entityKey: String(row.entity_key ?? row.entityKey ?? ""),
      attribution: row.attribution ? String(row.attribution) : null,
      licenseName: String(row.license_name ?? row.licenseName ?? "Licença não informada"),
    };
  }).filter((asset) => asset.imageUrl);
}
function readDispatchStatus(payload: Record<string, unknown>): DispatchStatus {
  const receipts = payload.receipts_status ?? payload.receipt_status ?? payload.receipts;
  return { id: String(payload.dispatch_id ?? payload.id ?? ""), state: String(payload.state ?? payload.status ?? "queued").toLowerCase(), accepted: numberOrNull(payload.accepted_count ?? payload.accepted), rejected: numberOrNull(payload.rejected_count ?? payload.rejected), receipts: typeof receipts === "string" ? receipts : receipts && typeof receipts === "object" ? String((receipts as Record<string, unknown>).status ?? "processing") : null, error: payload.error ? String(payload.error) : null };
}
async function apiFetch(path: string, session: Session, init: RequestInit = {}) {
  const base = apiBaseUrl();
  if (!base) throw new Error("Configure NEXT_PUBLIC_SPECTRUM_API_URL para conectar à API.");
  const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${session.access_token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers }, cache: "no-store" });
  if (response.status === 401) {
    await getSupabaseBrowserClient().auth.signOut();
    throw new Error("Sessão expirada. Entre novamente para continuar.");
  }
  if (response.status === 403) throw new Error("Acesso não autorizado. Esta conta não está habilitada para o painel.");
  if (!response.ok) {
    let detail = `A API respondeu com HTTP ${response.status}.`;
    try { const error = await response.json() as Record<string, unknown>; detail = String(error.detail ?? error.message ?? detail); } catch { /* resposta sem JSON */ }
    throw new Error(detail);
  }
  return response;
}
function formatDate(value: string | null) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const elapsed = Math.abs(Date.now() - date.getTime());
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  const amount = minutes < 60 ? minutes : minutes < 1_440 ? Math.floor(minutes / 60) : Math.floor(minutes / 1_440);
  const unit: Intl.RelativeTimeFormatUnit = minutes < 60 ? "minute" : minutes < 1_440 ? "hour" : "day";
  const relativeAmount = date.getTime() > Date.now() ? amount : -amount;
  return new Intl.RelativeTimeFormat("pt-BR", { numeric: "always" }).format(relativeAmount, unit);
}
function Icon({ name, size = 18 }: { name: "spark" | "search" | "arrow" | "bell" | "logout" | "close" | "check" | "refresh" | "copy"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths = {
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" /><path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1 1-2.5Z" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}
function Brand() { return <div className="brand"><Image src={prismaLogo} alt="" width={40} height={40} priority className="brand-logo-image" /><span>prisma<span className="brand-light">news</span><small>NOTIFICATION STUDIO</small></span></div>; }

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [adminAccess, setAdminAccess] = useState<AdminAccess>("checking");
  const [adminCheckAttempt, setAdminCheckAttempt] = useState(0);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [authError, setAuthError] = useState(""); const [authBusy, setAuthBusy] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]); const [page, setPage] = useState(1); const [totalPages, setTotalPages] = useState(1); const [totalTopics, setTotalTopics] = useState(0);
  const [copiedTopicField, setCopiedTopicField] = useState<string | null>(null); const [copyTopicError, setCopyTopicError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"notifications" | "images">("notifications");
  const [imageCategory, setImageCategory] = useState<ImageEntityType>("public_figure");
  const [imageRefresh, setImageRefresh] = useState(0);
  const [imageAssets, setImageAssets] = useState<ImageAsset[]>([]); const [loadingImages, setLoadingImages] = useState(false); const [imagesError, setImagesError] = useState(""); const [copiedImageId, setCopiedImageId] = useState<string | null>(null);
  const [query, setQuery] = useState(""); const [activeQuery, setActiveQuery] = useState(""); const [loadingTopics, setLoadingTopics] = useState(false); const [topicsError, setTopicsError] = useState("");
  const [selected, setSelected] = useState<Topic | null>(null); const [editedTitle, setEditedTitle] = useState(""); const [editedBody, setEditedBody] = useState("");
  const [dispatchRequest, setDispatchRequest] = useState<DispatchRequest | null>(null); const [dispatchBusy, setDispatchBusy] = useState(false); const [dispatchStatus, setDispatchStatus] = useState<DispatchStatus | null>(null); const [dispatchError, setDispatchError] = useState(""); const [checkingStatus, setCheckingStatus] = useState(false);
  const currentSession = useRef<Session | null>(null); const statusAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuoteIndex((index) => (index + 1) % MOTIVATIONAL_QUOTES.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    const initializeAuth = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        currentSession.current = data.session;
        setAdminAccess("checking");
        setAuthReady(true);
        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (!active) return;
          setSession(nextSession); currentSession.current = nextSession; setAdminAccess("checking");
          if (!nextSession) { setTopics([]); setSelected(null); setDispatchStatus(null); setDispatchRequest(null); }
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      } catch (error) {
        if (active) {
          setAuthError(error instanceof Error ? error.message : "Não foi possível inicializar o login.");
          setAuthReady(true);
        }
      }
    };
    void initializeAuth();
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const checkAdmin = async () => {
      try {
        const { data, error } = await getSupabaseBrowserClient().rpc("is_current_user_admin");
        if (error) throw error;
        if (active) setAdminAccess(data === true ? "allowed" : "denied");
      } catch {
        if (active) setAdminAccess("error");
      }
    };
    const timer = setTimeout(() => { void checkAdmin(); }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [session, adminCheckAttempt]);

  const fetchTopics = useCallback(async (targetPage: number, search: string, activeSession: Session) => {
    setLoadingTopics(true); setTopicsError("");
    try {
      const params = new URLSearchParams({ page: String(targetPage), page_size: String(PAGE_SIZE), search });
      const response = await apiFetch(`/notifications/admin/topics?${params}`, activeSession);
      const result = readTopicPage(await response.json() as Record<string, unknown>, targetPage);
      setTopics(result.topics); setPage(result.page); setTotalPages(result.totalPages); setTotalTopics(result.total);
    } catch (error) { setTopicsError(error instanceof Error ? error.message : "Não foi possível carregar os tópicos."); }
    finally { setLoadingTopics(false); }
  }, []);
  useEffect(() => {
    if (!session || adminAccess !== "allowed") return;
    const timer = setTimeout(() => { void fetchTopics(page, activeQuery, session); }, 0);
    return () => clearTimeout(timer);
  }, [session, adminAccess, page, activeQuery, fetchTopics]);

  useEffect(() => {
    if (!session || adminAccess !== "allowed" || activeSection !== "images") return;
    let active = true;
    const loadImages = async () => {
      setLoadingImages(true); setImagesError(""); setImageAssets([]);
      try {
        const params = new URLSearchParams({ entity_type: imageCategory });
        const response = await apiFetch(`/notifications/admin/images?${params}`, session);
        const payload = await response.json() as Record<string, unknown>;
        if (active) setImageAssets(readImageAssets(payload));
      } catch (error) {
        if (active) setImagesError(error instanceof Error ? error.message : "Não foi possível carregar as imagens.");
      } finally {
        if (active) setLoadingImages(false);
      }
    };
    void loadImages();
    return () => { active = false; };
  }, [session, adminAccess, activeSection, imageCategory, imageRefresh]);

  useEffect(() => {
    if (!session || adminAccess !== "allowed" || !dispatchStatus?.id || TERMINAL_STATES.has(dispatchStatus.state)) return;
    let cancelled = false; const controller = new AbortController(); statusAbort.current = controller;
    const poll = async () => {
      try {
        const activeSession = currentSession.current; if (!activeSession) return;
        const response = await apiFetch(`/notifications/admin/dispatches/${encodeURIComponent(dispatchStatus.id)}`, activeSession, { signal: controller.signal });
        const next = readDispatchStatus(await response.json() as Record<string, unknown>); if (!cancelled) setDispatchStatus(next);
      } catch (error) { if (!cancelled && !controller.signal.aborted) setDispatchError(error instanceof Error ? error.message : "Não foi possível consultar o envio."); }
      finally { if (!cancelled) setCheckingStatus(false); }
    };
    const initialPoll = setTimeout(() => { setCheckingStatus(true); void poll(); }, 0);
    const timer = setInterval(() => { setCheckingStatus(true); void poll(); }, 3000);
    return () => { cancelled = true; clearTimeout(initialPoll); clearInterval(timer); controller.abort(); if (statusAbort.current === controller) statusAbort.current = null; };
  }, [session, adminAccess, dispatchStatus?.id, dispatchStatus?.state]);

  const selectedTopic = useMemo(() => topics.find((topic) => topic.id === selected?.id) ?? selected, [topics, selected]);
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthError(""); setAuthBusy(true);
    try { const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error; setPassword(""); }
    catch (error) { setAuthError(error instanceof Error ? error.message : "Não foi possível entrar."); } finally { setAuthBusy(false); }
  }
  async function handleLogout() { await getSupabaseBrowserClient().auth.signOut(); setAuthError(""); }
  function handleSearch(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPage(1); setActiveQuery(query.trim()); }
  function chooseTopic(topic: Topic) { setSelected(topic); setEditedTitle(TITLE_SUGGESTIONS[0].slice(0, TITLE_LIMIT)); setEditedBody(topic.title); setDispatchStatus(null); setDispatchRequest(null); setDispatchError(""); }
  function closeReview() { setSelected(null); setDispatchRequest(null); setDispatchStatus(null); setDispatchError(""); statusAbort.current?.abort(); }
  async function submitDispatch(request: DispatchRequest) {
    const activeSession = currentSession.current; if (!activeSession || dispatchBusy) return;
    setDispatchBusy(true); setDispatchError(""); setDispatchRequest(request);
    try {
      const response = await apiFetch("/notifications/admin/dispatches", activeSession, { method: "POST", headers: { "Idempotency-Key": request.idempotencyKey }, body: JSON.stringify({ topic_id: request.topicId, title: request.title, body: request.body }) });
      const status = readDispatchStatus(await response.json() as Record<string, unknown>);
      if (!status.id) throw new Error("A API aceitou a solicitação, mas não retornou dispatch_id.");
      setDispatchStatus(status);
    } catch (error) { setDispatchError(error instanceof Error ? error.message : "Falha ao solicitar o envio."); }
    finally { setDispatchBusy(false); }
  }
  function beginDispatch() {
    if (!selectedTopic || dispatchBusy || !editedTitle.trim() || !editedBody.trim()) return;
    void submitDispatch({ topicId: selectedTopic.id, title: editedTitle.trim(), body: editedBody.trim(), idempotencyKey: crypto.randomUUID() });
  }
  async function copyImageUrl(asset: ImageAsset) {
    try {
      await navigator.clipboard.writeText(asset.imageUrl);
      setCopiedImageId(asset.id);
      window.setTimeout(() => setCopiedImageId((current) => current === asset.id ? null : current), 1800);
    } catch {
      setImagesError("Não foi possível copiar o link. Verifique as permissões da área de transferência do navegador.");
    }
  }
  async function copyTopicField(topic: Topic, field: "title" | "summary") {
    const value = field === "title" ? topic.title : topic.summary;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      const copiedKey = `${topic.id}:${field}`;
      setCopiedTopicField(copiedKey);
      setCopyTopicError(null);
      window.setTimeout(() => setCopiedTopicField((current) => current === copiedKey ? null : current), 1800);
    } catch {
      setCopyTopicError(`${topic.id}:${field}`);
      window.setTimeout(() => setCopyTopicError((current) => current === `${topic.id}:${field}` ? null : current), 3000);
    }
  }

  if (!authReady) return <main className="boot-screen" aria-label="Carregando painel"><span className="loader" /><span>Preparando seu espaço seguro…</span></main>;
  if (!session) return (
    <main className="login-layout">
      <section className="login-aside"><div className="login-aside-inner"><Brand /><div className="login-message"><span className="eyebrow"><span className="live-dot" /> CENTRAL DE DISTRIBUIÇÃO</span><h1>Uma boa história merece chegar <em>mais longe.</em></h1><p>Um espaço reservado para a equipe editorial transformar os assuntos mais importantes em conversas.</p></div><div className="aside-foot"><span>PRISMA NEWS</span><span>•</span><span>COMUNICAÇÃO COM INTENÇÃO</span></div></div><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /></section>
      <section className="login-panel"><div className="login-card"><div className="login-icon"><Icon name="spark" size={24} /></div><p className="eyebrow muted">ÁREA RESTRITA</p><h2>Boas-vindas.</h2><p className="login-subtitle">Entre com a conta administrativa provisionada pela equipe.</p><form onSubmit={handleLogin} className="login-form"><label htmlFor="email">E-mail</label><input id="email" autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@prismanews.com" required /><label htmlFor="password">Senha</label><input id="password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" required />{authError && <p className="inline-error" role="alert">{authError}</p>}<button className="button button-primary login-submit" disabled={authBusy} type="submit">{authBusy ? <><span className="small-spinner" /> Entrando…</> : <>Entrar no painel <Icon name="arrow" /></>}</button></form><p className="login-note"><span className="lock-dot" /> Acesso somente por processo interno. Não há criação de conta.</p></div><div className="login-panel-foot">© {new Date().getFullYear()} Prisma News <span>•</span> Uso interno</div></section>
    </main>
  );

  if (adminAccess === "checking") return <main className="boot-screen" aria-live="polite"><span className="loader" /><span>Verificando acesso administrativo…</span></main>;
  if (adminAccess !== "allowed") return (
    <main className="boot-screen access-denied" role="alert">
      <div className="access-denied-card"><span className="login-icon"><Icon name="close" size={24} /></span><p className="eyebrow muted">ACESSO RESTRITO</p><h1>{adminAccess === "denied" ? "Acesso não autorizado" : "Não foi possível verificar o acesso"}</h1><p>{adminAccess === "denied" ? "Esta conta não está marcada como administradora no perfil Prisma News." : "A verificação de perfil falhou. Tente novamente ou fale com a equipe responsável."}</p><div className="access-actions"><button className="button button-secondary" onClick={() => { setAdminAccess("checking"); setAdminCheckAttempt((attempt) => attempt + 1); }}>Tentar novamente</button><button className="button button-primary" onClick={handleLogout}>Sair</button></div></div>
    </main>
  );

  return (
    <main className="dashboard-shell">
      <aside className="sidebar"><Brand /><div className="sidebar-label">WORKSPACE</div><button className={`workspace-nav ${activeSection === "notifications" ? "nav-active" : ""}`} onClick={() => setActiveSection("notifications")}><span className="nav-icon"><Icon name="bell" /></span>Notificações</button><button className={`workspace-nav ${activeSection === "images" ? "nav-active" : ""}`} onClick={() => setActiveSection("images")}><span className="nav-icon">▧</span>Imagens</button><div className="sidebar-bottom"><div className="sidebar-tip" aria-label="Mensagem motivacional"><span className="tip-kicker"><i /> UMA IDEIA PARA HOJE</span><span className="tip-quote-mark" aria-hidden="true">“</span><p key={quoteIndex} className="tip-quote">{MOTIVATIONAL_QUOTES[quoteIndex]}</p><div className="tip-progress" aria-label={`Frase ${quoteIndex + 1} de ${MOTIVATIONAL_QUOTES.length}`}>{MOTIVATIONAL_QUOTES.map((quote, index) => <span key={quote} className={index === quoteIndex ? "tip-progress-active" : ""} />)}</div></div><div className="profile"><div className="avatar">{session.user.email?.trim().toLowerCase() === "gustavosantos.kng@gmail.com" ? <Image src={gustaPhoto} alt="Foto de Gustavo" width={32} height={32} className="profile-photo" /> : (session.user.email?.[0] ?? "P").toUpperCase()}</div><div className="profile-data"><strong>{session.user.email}</strong><span>Administrador</span></div><button className="icon-button logout-button" title="Sair" aria-label="Sair" onClick={handleLogout}><Icon name="logout" /></button></div></div></aside>
      <section className="main-content" id="topics"><header className="topbar"><div className="breadcrumb">Prisma News <span>/</span> <strong>{activeSection === "images" ? "Imagens" : "Notificações"}</strong></div><div className="mobile-sections"><button className={activeSection === "notifications" ? "mobile-section-active" : ""} onClick={() => setActiveSection("notifications")}>Notificações</button><button className={activeSection === "images" ? "mobile-section-active" : ""} onClick={() => setActiveSection("images")}>Imagens</button></div><button className="mobile-logout" onClick={handleLogout}><Icon name="logout" /> Sair</button><div className="topbar-tag"><span className="live-dot" /> AMBIENTE SEGURO</div></header>
        <div className="page-content">{activeSection === "images" ? <section className="images-page"><div className="page-heading"><div><p className="eyebrow muted">BIBLIOTECA EDITORIAL</p><h1>Imagens</h1><p className="page-intro">Catálogo curado de imagens com origem e direitos revisados.</p></div><div className="published-count"><span className="count-icon">▧</span><div><strong>{imageAssets.length}</strong><span>nesta categoria</span></div></div></div><div className="image-category-tabs" role="tablist" aria-label="Categorias de imagens">{IMAGE_CATEGORIES.map((category) => <button key={category.id} type="button" role="tab" aria-selected={imageCategory === category.id} className={imageCategory === category.id ? "image-category-active" : ""} onClick={() => setImageCategory(category.id)}>{category.label}</button>)}</div>{imagesError && <div className="error-banner" role="alert"><span>{imagesError}</span><button className="text-button" onClick={() => setImageRefresh((value) => value + 1)}>Tentar novamente</button></div>}{loadingImages ? <div className="topic-loading" aria-live="polite"><span className="loader" /><span>Carregando catálogo…</span></div> : imagesError ? null : imageAssets.length === 0 ? <div className="empty-state"><span className="empty-icon">▧</span><h3>Nenhuma imagem nesta categoria</h3><p>Imagens ativas do catálogo aparecerão aqui.</p></div> : <div className="image-grid">{imageAssets.map((asset) => <article className="image-asset-card" key={asset.id}><div className="image-preview"><Image src={asset.imageUrl} alt={asset.displayName} fill unoptimized sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw" referrerPolicy="no-referrer" /></div><div className="image-asset-info"><h2>{asset.displayName}</h2><p>{asset.attribution || asset.licenseName}</p><button className="button button-secondary copy-image-button" onClick={() => void copyImageUrl(asset)}>{copiedImageId === asset.id ? "Link copiado" : "Copiar link da imagem"}</button></div></article>)}</div>}<footer className="page-footer"><span>Prisma News <span>•</span> Painel interno</span><span>Uso de imagens conforme licença e atribuição cadastradas.</span></footer></section> : <><div className="page-heading"><div><p className="eyebrow muted">DISTRIBUIÇÃO EDITORIAL</p><h1>Notificações <span className="heading-spark">✳</span></h1><p className="page-intro">Escolha uma pauta publicada e leve-a até os leitores.</p></div><div className="published-count"><span className="count-icon"><Icon name="spark" /></span><div><strong>{totalTopics}</strong><span>pautas disponíveis</span></div></div></div>
          <div className="section-heading"><div><h2>Pautas publicadas</h2><p>Conteúdos revisados e prontos para compartilhar.</p></div><form className="search-form" onSubmit={handleSearch}><Icon name="search" /><input aria-label="Buscar pautas" placeholder="Buscar pautas…" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit">Buscar</button></form></div>
          {topicsError && <div className="error-banner" role="alert"><span>{topicsError}</span><button className="text-button" onClick={() => session && void fetchTopics(page, activeQuery, session)}>Tentar novamente</button></div>}
          {loadingTopics ? <div className="topic-loading" aria-live="polite"><span className="loader" /><span>Buscando pautas publicadas…</span></div> : topics.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="search" size={25} /></span><h3>{activeQuery ? "Nenhuma pauta encontrada" : "Ainda não há pautas por aqui"}</h3><p>{activeQuery ? "Tente ajustar sua busca ou limpar o campo." : "Pautas elegíveis aparecerão aqui quando forem publicadas."}</p>{activeQuery && <button className="button button-secondary" onClick={() => { setQuery(""); setActiveQuery(""); setPage(1); }}>Limpar busca</button>}</div> : <div className="topic-list">{topics.map((topic) => <article className="topic-card" key={topic.id}><div className="topic-date"><span className="date-mark" /><span>{formatDate(topic.publishedAt)}</span></div><h3>{topic.title}</h3><p className="topic-summary">{topic.summary || "Sem resumo disponível."}</p><div className="topic-card-actions"><div className="topic-copy-actions"><button type="button" className="topic-copy-button" onClick={() => void copyTopicField(topic, "title")} aria-label={copiedTopicField === `${topic.id}:title` ? "Título copiado" : `Copiar título: ${topic.title}`} title="Copiar título"><Icon name={copiedTopicField === `${topic.id}:title` ? "check" : "copy"} size={14} /><span>título</span></button><button type="button" className="topic-copy-button" onClick={() => void copyTopicField(topic, "summary")} disabled={!topic.summary} aria-label={copiedTopicField === `${topic.id}:summary` ? "Sumário copiado" : `Copiar sumário: ${topic.title}`} title="Copiar sumário"><Icon name={copiedTopicField === `${topic.id}:summary` ? "check" : "copy"} size={14} /><span>sumário</span></button></div>{copyTopicError?.startsWith(`${topic.id}:`) && <span className="topic-copy-error" role="status">Falha ao copiar</span>}<div className="topic-footer"><span className="article-count"><span className="article-dot" />{topic.articleCount} {topic.articleCount === 1 ? "artigo" : "artigos"}</span><button className="button button-select" onClick={() => chooseTopic(topic)}>Selecionar <Icon name="arrow" size={16} /></button></div></div></article>)}</div>}
          {!loadingTopics && topics.length > 0 && <div className="pagination"><span>Página {page} de {totalPages}</span><div><button aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>←</button><button aria-label="Próxima página" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>→</button></div></div>}
          <footer className="page-footer"><span>Prisma News <span>•</span> Painel interno</span><span>Seleção editorial, distribuição responsável.</span></footer></>}
        </div>
      </section>
      {selectedTopic && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !dispatchBusy) closeReview(); }}><section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><header className="modal-header"><div><p className="eyebrow muted">REVISÃO DE ENVIO</p><h2 id="review-title">Tudo pronto para compartilhar?</h2></div><button className="icon-button close-button" aria-label="Fechar" onClick={closeReview} disabled={dispatchBusy}><Icon name="close" /></button></header>
        {!dispatchStatus ? <><div className="review-topic"><span className="review-badge"><Icon name="spark" size={15} /> PAUTA SELECIONADA</span><h3>{selectedTopic.title}</h3><p>{selectedTopic.summary || "Sem resumo disponível."}</p><div className="review-meta"><span>{formatDate(selectedTopic.publishedAt)}</span><span>•</span><span>{selectedTopic.articleCount} {selectedTopic.articleCount === 1 ? "artigo" : "artigos"}</span></div></div>
          <div className="edit-fields"><label htmlFor="push-title">Título da notificação <span>{editedTitle.length}/{TITLE_LIMIT}</span></label><input id="push-title" maxLength={TITLE_LIMIT} readOnly={Boolean(dispatchRequest)} value={editedTitle} onChange={(event) => setEditedTitle(event.target.value)} /><div className="title-suggestions" aria-label="Sugestões de título">{TITLE_SUGGESTIONS.map((suggestion) => <button className={`suggestion-chip ${editedTitle === suggestion.slice(0, TITLE_LIMIT) ? "suggestion-selected" : ""}`} type="button" key={suggestion} disabled={Boolean(dispatchRequest)} onClick={() => setEditedTitle(suggestion.slice(0, TITLE_LIMIT))}>{suggestion}</button>)}</div><label htmlFor="push-body">Título da matéria — texto da notificação <span>{editedBody.length}/{BODY_LIMIT}</span></label><textarea id="push-body" rows={2} maxLength={BODY_LIMIT} readOnly value={editedBody} aria-describedby="push-body-note" /><span id="push-body-note" className="field-note">Preenchido automaticamente com o título completo da matéria selecionada.</span>{editedBody.length > BODY_LIMIT && <p className="inline-error" role="alert">O título da matéria excede o limite atual de {BODY_LIMIT} caracteres do corpo. Ajuste NEXT_PUBLIC_NOTIFICATION_BODY_LIMIT ao limite aceito pela API antes de enviar.</p>}</div>
          <div className="audience-note"><span className="audience-icon"><Icon name="bell" size={17} /></span><div><strong>Audiência: todos os dispositivos ativos</strong><p>O envio alcança todos os tokens de dispositivo ativos registrados no app. Não há segmentação por pessoa ou status Premium.</p></div></div><div className="image-note"><span>✳</span><p>A imagem é escolhida automaticamente: a IA sugere até três sujeitos centrais e o sistema usa a primeira correspondência ativa do catálogo.</p></div>
          {dispatchError && <div className="inline-error dispatch-error" role="alert"><span>{dispatchError}</span>{dispatchRequest && <button className="text-button" disabled={dispatchBusy} onClick={() => void submitDispatch(dispatchRequest)}>Repetir a mesma solicitação</button>}</div>}
          <div className="modal-actions"><button className="button button-secondary" onClick={closeReview} disabled={dispatchBusy}>Cancelar</button><button className="button button-primary" onClick={beginDispatch} disabled={dispatchBusy || Boolean(dispatchRequest) || !editedTitle.trim() || !editedBody.trim() || editedBody.length > BODY_LIMIT}>{dispatchBusy ? <><span className="small-spinner" /> Solicitando…</> : <>Confirmar envio <Icon name="arrow" /></>}</button></div>
        </> : <div className="dispatch-result"><div className={`status-illustration status-${dispatchStatus.state}`}><Icon name={TERMINAL_STATES.has(dispatchStatus.state) ? dispatchStatus.state === "sent" ? "check" : "close" : "refresh"} size={25} /></div><p className="eyebrow muted">ACOMPANHAMENTO DO ENVIO</p><h3>{dispatchStatus.state === "queued" ? "Na fila para envio" : dispatchStatus.state === "sending" ? "Envio em andamento" : dispatchStatus.state === "sent" ? "Envio concluído" : dispatchStatus.state === "failed" ? "Não foi possível concluir" : `Estado: ${dispatchStatus.state}`}</h3><p className="result-topic">{selectedTopic.title}</p><div className="status-track"><span className={dispatchStatus.state !== "failed" ? "step-done" : "step-failed"}><i />Solicitação recebida</span><span className={["sending", "sent"].includes(dispatchStatus.state) ? "step-done" : dispatchStatus.state === "failed" ? "step-failed" : ""}><i />Processamento</span><span className={dispatchStatus.state === "sent" ? "step-done" : dispatchStatus.state === "failed" ? "step-failed" : ""}><i />Envio ao Expo</span></div><div className="count-grid"><div><strong>{dispatchStatus.accepted ?? "—"}</strong><span>Aceitos pelo Expo</span></div><div><strong>{dispatchStatus.rejected ?? "—"}</strong><span>Rejeitados</span></div><div><strong>{dispatchStatus.receipts ?? (checkingStatus ? "Consultando" : "Pendente")}</strong><span>Estado dos receipts</span></div></div>{dispatchStatus.error && <p className="inline-error" role="alert">{dispatchStatus.error}</p>}<p className="delivery-disclaimer">Aceitação pelo Expo não confirma que a notificação foi exibida no aparelho.</p>{dispatchError && <div className="inline-error" role="alert">{dispatchError}</div>}{!TERMINAL_STATES.has(dispatchStatus.state) && <p className="polling-note"><span className="small-spinner" /> Atualização automática a cada 3 segundos</p>}<div className="modal-actions result-actions"><button className="button button-secondary" onClick={() => { if (session) void fetchTopics(page, activeQuery, session); }}>Atualizar pautas</button><button className="button button-primary" onClick={closeReview}>Concluir</button></div></div>}</section></div>}
    </main>
  );
}
