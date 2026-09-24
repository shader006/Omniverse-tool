export interface MediaInfoResult {
  title?: string;
  duration?: string | number;
  duration_str?: string;
  duration_seconds?: number;
  thumbnail?: string;
  uploader?: string;
  platform?: string;
  url?: string;
  original_url?: string;
  formats?: any[];
  [key: string]: any;
}

export interface DownloadProgressEvent {
  status: string;
  percent?: number;
  speed?: string;
  eta?: string;
  filename?: string;
  download_url?: string;
  error?: string;
}

export interface MediaWorkerPort {
  fetchMediaInfo(url: string): Promise<MediaInfoResult>;
  triggerDownload(
    payload: {
      job_id: string;
      url: string;
      format: string;
      quality: string;
      download_dir: string;
    },
    onProgress: (event: DownloadProgressEvent) => void,
  ): Promise<void>;
}
