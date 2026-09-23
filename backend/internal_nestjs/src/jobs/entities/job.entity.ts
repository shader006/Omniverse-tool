export enum JobStatus {
  QUEUED = 'queued',
  DOWNLOADING = 'downloading',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

/**
 * Job Entity đại diện cho thực thể tác vụ chuyển đổi / xử lý media trong hệ thống NestJS
 */
export class Job {
  id: string;
  url: string;
  format: string;
  quality: string;
  status: JobStatus;
  percent: number;
  speed: string;
  eta: string;
  filename?: string;
  downloadUrl?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<Job>) {
    Object.assign(this, partial);
    this.status = this.status || JobStatus.QUEUED;
    this.percent = this.percent ?? 0;
    this.speed = this.speed || '0 KiB/s';
    this.eta = this.eta || '--:--';
    this.createdAt = this.createdAt || new Date();
    this.updatedAt = this.updatedAt || new Date();
  }

  isFinished(): boolean {
    return [JobStatus.COMPLETED, JobStatus.ERROR, JobStatus.CANCELLED].includes(this.status);
  }

  canCancel(): boolean {
    return !this.isFinished();
  }

  markCompleted(filename: string, downloadUrl: string): void {
    this.status = JobStatus.COMPLETED;
    this.percent = 100;
    this.filename = filename;
    this.downloadUrl = downloadUrl;
    this.error = undefined;
    this.updatedAt = new Date();
  }

  markError(errMsg: string): void {
    this.status = JobStatus.ERROR;
    this.error = errMsg;
    this.updatedAt = new Date();
  }

  markCancelled(): void {
    this.status = JobStatus.CANCELLED;
    this.error = 'Tác vụ đã bị huỷ';
    this.updatedAt = new Date();
  }

  updateProgress(percent: number, speed?: string, eta?: string): void {
    this.percent = percent;
    if (speed) this.speed = speed;
    if (eta) this.eta = eta;
    this.updatedAt = new Date();
  }
}
