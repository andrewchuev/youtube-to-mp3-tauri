import {useEffect, useState} from "react";
import {
    chooseOutputDir,
    clearJobs,
    getJob,
    getPlaylistInfo,
    getSettings,
    getVideoInfo,
    listJobs,
    openOutputDir,
    resetOutputDir,
    setOutputDirSetting,
    startConversion,
    startPlaylistConversion,
} from "../lib/tauri";
import type {Job, JobStatus, PlaylistInfo, ThemeMode, VideoInfo} from "../lib/types";

const THEME_STORAGE_KEY = "ytmp3-desktop.theme";

function formatDuration(seconds: number | null): string {
    if (seconds == null) return "—";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [
        hours > 0 ? String(hours).padStart(2, "0") : null,
        String(minutes).padStart(2, "0"),
        String(secs).padStart(2, "0"),
    ].filter(Boolean).join(":");
}

function formatSize(bytes: number | null): string {
    if (bytes == null) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getStatusLabel(status: JobStatus | undefined): string {
    switch (status) {
        case "queued": return "Queued";
        case "downloading": return "Downloading";
        case "converting": return "Converting";
        case "completed": return "Completed";
        case "failed": return "Failed";
        default: return "Unknown";
    }
}

function applyTheme(theme: ThemeMode) {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
}

function toErrorMessage(value: unknown, fallback: string): string {
    if (typeof value === "string" && value.trim()) return value;
    if (value instanceof Error && value.message.trim()) return value.message;
    if (value && typeof value === "object" && "message" in value) {
        const m = (value as {message?: unknown}).message;
        if (typeof m === "string" && m.trim()) return m;
    }
    return fallback;
}

function isPlaylistUrl(raw: string): boolean {
    try {
        const p = new URL(raw.trim());
        const host = p.hostname.toLowerCase();
        if (p.pathname === "/playlist" && p.searchParams.has("list")) return true;
        if (host === "music.youtube.com" && p.pathname.startsWith("/playlist")) return true;
        return false;
    } catch { return false; }
}

function isActiveStatus(status: JobStatus): boolean {
    return status === "queued" || status === "downloading" || status === "converting";
}

// ── Conversion modal ───────────────────────────────────────────────────────────

function SingleJobModal({job, onClose, onOpenFolder, isOpening}: {
    job: Job;
    onClose: () => void;
    onOpenFolder: () => void;
    isOpening: boolean;
}) {
    const active = isActiveStatus(job.status);

    const statusColors = job.status === "completed"
        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
        : job.status === "failed"
            ? "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20";

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Converting</div>
                    <h2 className="mt-1.5 text-lg font-semibold leading-tight text-slate-950 dark:text-white">{job.title ?? "Track"}</h2>
                </div>
                <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${statusColors}`}>
                    {getStatusLabel(job.status)}
                </span>
            </div>

            {active && (
                <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                    <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"/>
                    {getStatusLabel(job.status)}…
                </div>
            )}

            {job.status === "completed" && job.output_file_path && (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                    <div className="font-medium">Ready · {formatSize(job.file_size_bytes)}</div>
                    <div className="mt-1 break-all text-xs opacity-80">{job.output_file_path}</div>
                </div>
            )}

            {job.error && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {job.error}
                </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
                {job.status === "completed" && (
                    <button onClick={onOpenFolder} disabled={isOpening}
                        className="rounded-xl border border-emerald-500/30 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30">
                        {isOpening ? "Opening…" : "Open folder"}
                    </button>
                )}
                <button onClick={onClose} disabled={active}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                    {active ? "In progress…" : "Close"}
                </button>
            </div>
        </div>
    );
}

function BatchJobModal({batchJobs, albumTitle, onClose, onOpenFolder, isOpening}: {
    batchJobs: Job[];
    albumTitle: string;
    onClose: () => void;
    onOpenFolder: () => void;
    isOpening: boolean;
}) {
    const total = batchJobs.length;
    const done = batchJobs.filter(j => j.status === "completed").length;
    const failed = batchJobs.filter(j => j.status === "failed").length;
    const active = batchJobs.some(j => isActiveStatus(j.status));
    const current = batchJobs.find(j => j.status === "downloading" || j.status === "converting");

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Album conversion</div>
                    <h2 className="mt-1.5 text-lg font-semibold leading-tight text-slate-950 dark:text-white">{albumTitle}</h2>
                </div>
                <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                    active ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : failed > 0 && done < total ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
                    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                }`}>
                    {done} / {total} done
                </span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{width: `${total > 0 ? (done / total) * 100 : 0}%`}}/>
            </div>

            {/* Currently active track */}
            {current && (
                <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                    <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"/>
                    <span className="truncate">{getStatusLabel(current.status)}: {current.title}</span>
                </div>
            )}

            {/* Track list */}
            <div className="max-h-64 overflow-y-auto rounded-2xl border border-slate-200/70 dark:border-slate-800">
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {batchJobs.map((j, i) => (
                        <div key={j.id} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="w-5 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{j.title ?? j.url}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                                j.status === "completed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : j.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                : j.status === "queued" ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            }`}>
                                {getStatusLabel(j.status)}
                            </span>
                            <span className="w-14 shrink-0 text-right text-xs text-slate-400">{formatSize(j.file_size_bytes)}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
                {!active && done > 0 && (
                    <button onClick={onOpenFolder} disabled={isOpening}
                        className="rounded-xl border border-emerald-500/30 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30">
                        {isOpening ? "Opening…" : "Open folder"}
                    </button>
                )}
                <button onClick={onClose} disabled={active}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                    {active ? "In progress…" : "Close"}
                </button>
            </div>
        </div>
    );
}

// ── Main app ───────────────────────────────────────────────────────────────────

export default function App() {
    const [theme, setTheme] = useState<ThemeMode>("dark");
    const [mounted, setMounted] = useState(false);

    const [url, setUrl] = useState("");
    const [urlMode, setUrlMode] = useState<"single" | "playlist">("single");
    const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
    const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null);
    const [job, setJob] = useState<Job | null>(null);
    const [batchJobs, setBatchJobs] = useState<Job[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [outputDir, setOutputDir] = useState("");
    const [error, setError] = useState<string | null>(null);

    const [isLoadingInfo, setIsLoadingInfo] = useState(false);
    const [isStartingJob, setIsStartingJob] = useState(false);
    const [isChoosingOutputDir, setIsChoosingOutputDir] = useState(false);
    const [isOpeningOutputDir, setIsOpeningOutputDir] = useState(false);
    const [isResettingOutputDir, setIsResettingOutputDir] = useState(false);
    const [isClearingJobs, setIsClearingJobs] = useState(false);

    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        setMounted(true);
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        const next: ThemeMode = stored === "light" ? "light" : "dark";
        setTheme(next);
        applyTheme(next);
        void refreshJobs();
        void loadSettings();
    }, []);

    useEffect(() => {
        if (!mounted) return;
        applyTheme(theme);
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }, [mounted, theme]);

    useEffect(() => {
        setUrlMode(isPlaylistUrl(url) ? "playlist" : "single");
        setVideoInfo(null);
        setPlaylistInfo(null);
        setJob(null);
        setBatchJobs([]);
        setError(null);
        setShowModal(false);
    }, [url]);

    // Poll single job
    useEffect(() => {
        if (!job || !isActiveStatus(job.status)) return;
        const id = window.setInterval(async () => {
            try {
                const next = await getJob(job.id);
                setJob(next);
                await refreshJobs();
            } catch (e) { setError(toErrorMessage(e, "Unable to refresh job status")); }
        }, 1500);
        return () => window.clearInterval(id);
    }, [job]);

    // Poll batch jobs — preserve original order
    useEffect(() => {
        if (!batchJobs.some(j => isActiveStatus(j.status))) return;
        const id = window.setInterval(async () => {
            try {
                const all = await listJobs();
                setJobs(all);
                const map = new Map(all.map(j => [j.id, j]));
                setBatchJobs(prev => prev.map(j => map.get(j.id) ?? j));
            } catch (e) { setError(toErrorMessage(e, "Unable to refresh batch status")); }
        }, 1500);
        return () => window.clearInterval(id);
    }, [batchJobs]);

    async function loadSettings() {
        try { setOutputDir((await getSettings()).output_dir); } catch {}
    }

    async function refreshJobs() {
        try { setJobs(await listJobs()); } catch {}
    }

    async function handleFetchInfo() {
        setError(null);
        setVideoInfo(null);
        setPlaylistInfo(null);
        setJob(null);
        setBatchJobs([]);
        setShowModal(false);
        setIsLoadingInfo(true);
        try {
            if (urlMode === "playlist") {
                setPlaylistInfo(await getPlaylistInfo(url));
            } else {
                setVideoInfo(await getVideoInfo(url));
            }
            await refreshJobs();
        } catch (e) {
            setError(toErrorMessage(e, "Unable to load info"));
        } finally {
            setIsLoadingInfo(false);
        }
    }

    async function handleStartConversion() {
        setError(null);
        setJob(null);
        setIsStartingJob(true);
        try {
            const created = await startConversion(url);
            setJob(created);
            setShowModal(true);
            await refreshJobs();
        } catch (e) {
            setError(toErrorMessage(e, "Unable to start conversion"));
        } finally {
            setIsStartingJob(false);
        }
    }

    async function handleStartPlaylistConversion() {
        setError(null);
        setBatchJobs([]);
        setIsStartingJob(true);
        try {
            const created = await startPlaylistConversion(url);
            setBatchJobs(created);
            setShowModal(true);
            await refreshJobs();
        } catch (e) {
            setError(toErrorMessage(e, "Unable to start playlist conversion"));
        } finally {
            setIsStartingJob(false);
        }
    }

    async function handleChooseOutputDir() {
        setIsChoosingOutputDir(true);
        try {
            const selected = await chooseOutputDir(outputDir || undefined);
            if (!selected) return;
            setOutputDir((await setOutputDirSetting(selected)).output_dir);
        } catch (e) { setError(toErrorMessage(e, "Unable to change output folder")); }
        finally { setIsChoosingOutputDir(false); }
    }

    async function handleOpenOutputDir() {
        setIsOpeningOutputDir(true);
        try { await openOutputDir(); }
        catch (e) { setError(toErrorMessage(e, "Unable to open output folder")); }
        finally { setIsOpeningOutputDir(false); }
    }

    async function handleResetOutputDir() {
        setIsResettingOutputDir(true);
        try { setOutputDir((await resetOutputDir()).output_dir); }
        catch (e) { setError(toErrorMessage(e, "Unable to reset output folder")); }
        finally { setIsResettingOutputDir(false); }
    }

    async function handleClearJobs() {
        setIsClearingJobs(true);
        try {
            await clearJobs();
            setJobs([]);
            setVideoInfo(null);
            setPlaylistInfo(null);
            setBatchJobs([]);
            setJob(prev => (prev && isActiveStatus(prev.status)) ? prev : null);
        } catch (e) { setError(toErrorMessage(e, "Unable to clear recent jobs")); }
        finally { setIsClearingJobs(false); }
    }

    const isBatchActive = batchJobs.some(j => isActiveStatus(j.status));
    const isSingleActive = Boolean(job && isActiveStatus(job.status));
    const isConversionRunning = isBatchActive || isSingleActive || isStartingJob;

    const canSubmit = mounted && Boolean(url.trim()) && !isLoadingInfo && !isStartingJob && !isConversionRunning;

    // Active job badge for the header area
    const showActiveBadge = isConversionRunning && !showModal;

    const modalMode: "single" | "batch" | null =
        showModal && batchJobs.length > 0 ? "batch"
        : showModal && job ? "single"
        : null;

    return (
        <>
        <main className="px-4 py-8 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-6xl flex-col gap-6">

                <header className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-2xl shadow-slate-950/5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/20 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                        YouTube → MP3
                    </h1>
                    <div className="flex items-center gap-3">
                        {showActiveBadge && (
                            <button onClick={() => setShowModal(true)}
                                className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-500/15 dark:text-amber-300">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500"/>
                                In progress
                            </button>
                        )}
                        <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
                            className="inline-flex items-center justify-center rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-200 dark:hover:bg-slate-900">
                            {theme === "dark" ? "☀️ Light mode" : "🌙 Dark mode"}
                        </button>
                    </div>
                </header>

                <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-2xl shadow-slate-950/5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/20 sm:p-8">
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),300px]">

                        {/* Main column */}
                        <div className="grid gap-4">

                            {/* URL input */}
                            <div className="grid gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                                <div className="flex items-center gap-3">
                                    <label htmlFor="video-url" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                                        YouTube / YouTube Music URL
                                    </label>
                                    {urlMode === "playlist" && (
                                        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                                            Album / Playlist
                                        </span>
                                    )}
                                </div>

                                <input id="video-url" type="url"
                                    placeholder="https://www.youtube.com/watch?v=... or music.youtube.com/playlist?list=..."
                                    value={url}
                                    onChange={e => setUrl(e.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-red-400 focus:ring-4 focus:ring-red-500/15 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-red-500"/>

                                <div className="flex flex-wrap gap-3">
                                    <button type="button" onClick={handleFetchInfo} disabled={!canSubmit}
                                        className="inline-flex min-w-36 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
                                        {isLoadingInfo ? "Loading…" : urlMode === "playlist" ? "Get album info" : "Get video info"}
                                    </button>
                                    <button type="button"
                                        onClick={urlMode === "playlist" ? handleStartPlaylistConversion : handleStartConversion}
                                        disabled={!canSubmit}
                                        className="inline-flex min-w-36 items-center justify-center rounded-2xl bg-red-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400">
                                        {isStartingJob ? "Starting…" : urlMode === "playlist" ? "Convert album" : "Convert to MP3"}
                                    </button>
                                </div>
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                                    {error}
                                </div>
                            )}

                            {/* Compact video info */}
                            {videoInfo && (
                                <div className="flex items-center gap-4 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                                    {videoInfo.thumbnail && (
                                        <img src={videoInfo.thumbnail} alt=""
                                            className="h-14 w-24 shrink-0 rounded-xl object-cover"/>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{videoInfo.title}</div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500 dark:text-slate-400">
                                            {videoInfo.uploader && <span>{videoInfo.uploader}</span>}
                                            <span>{formatDuration(videoInfo.duration)}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Compact playlist info */}
                            {playlistInfo && (
                                <div className="flex items-center gap-4 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                                    {playlistInfo.thumbnail && (
                                        <img src={playlistInfo.thumbnail} alt=""
                                            className="h-14 w-14 shrink-0 rounded-xl object-cover"/>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{playlistInfo.title}</div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500 dark:text-slate-400">
                                            {playlistInfo.uploader && <span>{playlistInfo.uploader}</span>}
                                            <span>{playlistInfo.tracks.length} tracks</span>
                                        </div>
                                    </div>
                                    <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                                        {playlistInfo.tracks.length} tracks
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Sidebar */}
                        <aside className="grid gap-6 self-start">
                            <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 dark:border-slate-800 dark:bg-slate-950/50">
                                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Output folder</div>
                                <div className="mt-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200">
                                    <div className="break-all">{outputDir || "Not configured."}</div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {[
                                        {label: "Choose", loading: "Choosing…", busy: isChoosingOutputDir, onClick: handleChooseOutputDir},
                                        {label: "Open", loading: "Opening…", busy: isOpeningOutputDir, onClick: handleOpenOutputDir, disabled: !outputDir},
                                        {label: "Reset", loading: "Resetting…", busy: isResettingOutputDir, onClick: handleResetOutputDir},
                                    ].map(btn => (
                                        <button key={btn.label} type="button" onClick={btn.onClick}
                                            disabled={btn.busy || (btn as any).disabled}
                                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900">
                                            {btn.busy ? btn.loading : btn.label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 dark:border-slate-800 dark:bg-slate-950/50">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Recent jobs</div>
                                    <button type="button" onClick={handleClearJobs} disabled={isClearingJobs || jobs.length === 0}
                                        className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900">
                                        {isClearingJobs ? "Clearing…" : "Clear"}
                                    </button>
                                </div>
                                <div className="mt-3 grid gap-2">
                                    {jobs.length === 0 ? (
                                        <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
                                            No jobs yet.
                                        </div>
                                    ) : jobs.map(item => (
                                        <div key={item.id} className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                                            <div className="flex items-start gap-2">
                                                <div className="min-w-0 flex-1 truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                                                    {item.title || item.url}
                                                </div>
                                                {item.batch_id && (
                                                    <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">album</span>
                                                )}
                                            </div>
                                            <div className="mt-2 flex items-center justify-between gap-2">
                                                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                    {getStatusLabel(item.status)}
                                                </span>
                                                <span className="text-[10px] text-slate-400">{formatSize(item.file_size_bytes)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </aside>
                    </div>
                </section>
            </div>
        </main>

        {/* ── Conversion modal ── */}
        {modalMode && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
                style={{backgroundColor: "rgba(0,0,0,0.55)"}}>
                <div className="w-full max-w-lg rounded-3xl border border-slate-200/70 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                    {modalMode === "single" && job && (
                        <SingleJobModal
                            job={job}
                            onClose={() => setShowModal(false)}
                            onOpenFolder={handleOpenOutputDir}
                            isOpening={isOpeningOutputDir}
                        />
                    )}
                    {modalMode === "batch" && (
                        <BatchJobModal
                            batchJobs={batchJobs}
                            albumTitle={playlistInfo?.title ?? batchJobs[0]?.title ?? "Album"}
                            onClose={() => setShowModal(false)}
                            onOpenFolder={handleOpenOutputDir}
                            isOpening={isOpeningOutputDir}
                        />
                    )}
                </div>
            </div>
        )}
        </>
    );
}
