import { JobStatus } from '../entities/job.entity';

export class UpdateJobDto {
  status?: JobStatus;
  percent?: number;
  speed?: string;
  eta?: string;
  filename?: string;
  downloadUrl?: string;
  error?: string;
}
