import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppSettings, Job, PlaylistInfo, VideoInfo } from "./types";

export function getVideoInfo(url: string): Promise<VideoInfo> {
  return invoke<VideoInfo>("get_video_info", { url });
}

export function startConversion(url: string): Promise<Job> {
  return invoke<Job>("start_conversion", { url });
}

export function getJob(jobId: string): Promise<Job> {
  return invoke<Job>("get_job", { jobId });
}

export function listJobs(): Promise<Job[]> {
  return invoke<Job[]>("list_jobs");
}

export function clearJobs(): Promise<void> {
  return invoke<void>("clear_jobs");
}

export function getPlaylistInfo(url: string): Promise<PlaylistInfo> {
  return invoke<PlaylistInfo>("get_playlist_info", { url });
}

export function startPlaylistConversion(url: string): Promise<Job[]> {
  return invoke<Job[]>("start_playlist_conversion", { url });
}

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export function setOutputDirSetting(path: string): Promise<AppSettings> {
  return invoke<AppSettings>("set_output_dir", { path });
}

export function resetOutputDir(): Promise<AppSettings> {
  return invoke<AppSettings>("reset_output_dir");
}

export function openOutputDir(): Promise<void> {
  return invoke<void>("open_output_dir");
}

export async function chooseOutputDir(defaultPath?: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose output folder",
    defaultPath,
  });

  return typeof selected === "string" ? selected : null;
}