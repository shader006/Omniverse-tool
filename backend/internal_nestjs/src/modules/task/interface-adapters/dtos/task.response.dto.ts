import { TaskStatus } from '../../domain/value-objects/task-status.enum';

export class TaskResponseDto {
  job_id: string;
  id: string;
  url: string;
  format: string;
  quality: string;
  status: TaskStatus;
  percent: number;
  speed: string;
  eta: string;
  filename?: string;
  download_url?: string;
  error?: string;
  created_at: number;
  createdAt: Date;
  updatedAt: Date;
}
