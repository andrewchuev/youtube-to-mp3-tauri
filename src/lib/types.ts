export type ThemeMode = "light" | "dark";

export type VideoInfo = {
  title: string;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
  webpage_url: string;
};

export type PlaylistTrack = {
  title: string;
  url: string;
  duration: number | null;
};

export type PlaylistInfo = {
  title: string;
  uploader: string | null;
  thumbnail: string | null;
  webpage_url: string;
  tracks: PlaylistTrack[];
};

export type JobStatus =
    | "queued"
    | "downloading"
    | "converting"
    | "completed"
    | "failed";

export type Job = {
  id: string;
  url: string;
  title: string | null;
  status: JobStatus;
  created_at: number;
  updated_at: number;
  error: string | null;
  output_file_name: string | null;
  output_file_path: string | null;
  file_size_bytes: number | null;
  batch_id: string | null;
  output_subdir: string | null;
};

export type AppSettings = {
  output_dir: string;
};