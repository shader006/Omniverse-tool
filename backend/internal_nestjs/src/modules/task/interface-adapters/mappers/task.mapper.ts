import { TaskEntity } from '../../domain/entities/task.entity';
import { TaskResponseDto } from '../dtos/task.response.dto';

export class TaskMapper {
  static toResponse(entity: TaskEntity): TaskResponseDto {
    const id = entity.id.value;
    const createdAtSeconds = Math.floor(entity.createdAt.getTime() / 1000);

    return {
      id,
      job_id: id,
      url: entity.url,
      format: entity.format,
      quality: entity.quality,
      status: entity.status,
      percent: entity.percent,
      speed: entity.speed,
      eta: entity.eta,
      filename: entity.filename,
      download_url: entity.downloadUrl,
      error: entity.error,
      created_at: createdAtSeconds,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
