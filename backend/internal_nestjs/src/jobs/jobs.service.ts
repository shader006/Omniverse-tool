import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Job, JobStatus } from './entities/job.entity';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';

@Injectable()
export class JobsService {
  private readonly jobs: Map<string, Job> = new Map();

  /**
   * Tạo một Job mới (Create)
   */
  create(createJobDto: CreateJobDto): Job {
    if (!createJobDto.url) {
      throw new BadRequestException('URL không được để trống');
    }

    const id = uuidv4();
    const job = new Job({
      id,
      url: createJobDto.url,
      format: createJobDto.format || 'mp4',
      quality: createJobDto.quality || '1080p',
      status: JobStatus.QUEUED,
      percent: 0,
      speed: '0 KiB/s',
      eta: '--:--',
    });

    this.jobs.set(id, job);
    return job;
  }

  /**
   * Lấy danh sách tất cả các Jobs (Read All)
   */
  findAll(): Job[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /**
   * Lấy chi tiết một Job theo ID (Read One)
   */
  findOne(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) {
      throw new NotFoundException(`Không tìm thấy Job với ID: ${id}`);
    }
    return job;
  }

  /**
   * Cập nhật thông tin hoặc tiến độ Job (Update)
   */
  update(id: string, updateJobDto: UpdateJobDto): Job {
    const job = this.findOne(id);

    if (updateJobDto.percent !== undefined) {
      job.updateProgress(updateJobDto.percent, updateJobDto.speed, updateJobDto.eta);
    }
    if (updateJobDto.status) {
      job.status = updateJobDto.status;
    }
    if (updateJobDto.filename) {
      job.filename = updateJobDto.filename;
    }
    if (updateJobDto.downloadUrl) {
      job.downloadUrl = updateJobDto.downloadUrl;
    }
    if (updateJobDto.error) {
      job.error = updateJobDto.error;
    }
    job.updatedAt = new Date();

    this.jobs.set(id, job);
    return job;
  }

  /**
   * Huỷ bỏ Job đang chạy
   */
  cancel(id: string): Job {
    const job = this.findOne(id);
    if (!job.canCancel()) {
      throw new BadRequestException(`Không thể huỷ tác vụ đang ở trạng thái: ${job.status}`);
    }
    job.markCancelled();
    this.jobs.set(id, job);
    return job;
  }

  /**
   * Xoá một Job khỏi hệ thống (Delete)
   */
  remove(id: string): { success: boolean; message: string } {
    const job = this.findOne(id);
    this.jobs.delete(job.id);
    return {
      success: true,
      message: `Đã xoá Job ${id} thành công`,
    };
  }
}
