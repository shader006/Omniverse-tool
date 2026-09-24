import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { GetMediaInfoUseCase } from '../../application/use-cases/get-media-info.use-case';
import { StartDownloadUseCase } from '../../application/use-cases/start-download.use-case';

export class InfoRequestBodyDto {
  url: string;
}

export class DownloadRequestBodyDto {
  url: string;
  format?: string;
  quality?: string;
}

@Controller()
export class MediaHttpController {
  constructor(
    private readonly getMediaInfoUseCase: GetMediaInfoUseCase,
    private readonly startDownloadUseCase: StartDownloadUseCase,
  ) {}

  /**
   * POST /api/info - Trích xuất thông tin video/audio
   */
  @Post('info')
  @HttpCode(HttpStatus.OK)
  async getInfo(@Body() body: InfoRequestBodyDto) {
    const info = await this.getMediaInfoUseCase.execute(body.url);
    return {
      success: true,
      data: info,
    };
  }

  /**
   * POST /api/download - Bắt đầu tải video/audio
   */
  @Post('download')
  @HttpCode(HttpStatus.OK)
  async download(@Body() body: DownloadRequestBodyDto) {
    const res = await this.startDownloadUseCase.execute({
      url: body.url,
      format: body.format,
      quality: body.quality,
    });
    return {
      success: true,
      job_id: res.job_id,
      status: res.status,
    };
  }
}
