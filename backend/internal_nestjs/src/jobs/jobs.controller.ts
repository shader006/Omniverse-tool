import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Job } from './entities/job.entity';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * POST /api/jobs - Tạo Job mới
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createJobDto: CreateJobDto): Job {
    return this.jobsService.create(createJobDto);
  }

  /**
   * GET /api/jobs - Lấy danh sách tất cả các Jobs
   */
  @Get()
  findAll(): Job[] {
    return this.jobsService.findAll();
  }

  /**
   * GET /api/jobs/:id - Lấy thông tin chi tiết một Job
   */
  @Get(':id')
  findOne(@Param('id') id: string): Job {
    return this.jobsService.findOne(id);
  }

  /**
   * PATCH /api/jobs/:id - Cập nhật trạng thái hoặc tiến độ Job
   */
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateJobDto: UpdateJobDto): Job {
    return this.jobsService.update(id, updateJobDto);
  }

  /**
   * POST /api/jobs/:id/cancel - Huỷ bỏ một Job đang chạy
   */
  @Post(':id/cancel')
  cancel(@Param('id') id: string): Job {
    return this.jobsService.cancel(id);
  }

  /**
   * DELETE /api/jobs/:id - Xoá Job khỏi hệ thống
   */
  @Delete(':id')
  remove(@Param('id') id: string): { success: boolean; message: string } {
    return this.jobsService.remove(id);
  }
}
