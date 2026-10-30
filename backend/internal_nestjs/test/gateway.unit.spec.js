const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { buildMultipartBuffer } = require('../dist/common/utils/multipart.util');
const { GetMediaInfoUseCase } = require('../dist/modules/media/application/use-cases/get-media-info.use-case');
const { StartDownloadUseCase } = require('../dist/modules/media/application/use-cases/start-download.use-case');
const { InMemoryTaskRepository } = require('../dist/modules/task/infrastructure/repositories/in-memory-task.repository');
const { CreateTaskUseCase } = require('../dist/modules/task/application/use-cases/create-task.use-case');
const { UpdateTaskProgressUseCase } = require('../dist/modules/task/application/use-cases/update-task-progress.use-case');
const { TaskId } = require('../dist/modules/task/domain/value-objects/task-id.vo');
const { TaskStatus } = require('../dist/modules/task/domain/value-objects/task-status.enum');

describe('Omniverse Internal NestJS Gateway - Unit Tests', () => {
  it('buildMultipartBuffer builds RFC 7578 compliant multipart/form-data payload', () => {
    const fileBuf = Buffer.from('hello world');
    const { body, contentType } = buildMultipartBuffer(
      { target_format: 'pdf' },
      { fieldname: 'files', filename: 'test.txt', contentType: 'text/plain', data: fileBuf },
    );

    assert.ok(contentType.startsWith('multipart/form-data; boundary='));
    const text = body.toString('utf8');
    assert.ok(text.includes('name="target_format"'));
    assert.ok(text.includes('filename="test.txt"'));
    assert.ok(text.includes('hello world'));
  });

  it('GetMediaInfoUseCase rejects missing, non-http, and SSRF loopback URLs', async () => {
    const mockWorker = {
      fetchMediaInfo: async (url) => ({ title: 'Mock Video', url }),
    };
    const useCase = new GetMediaInfoUseCase(mockWorker);

    await assert.rejects(() => useCase.execute(''), { name: 'BadRequestException' });
    await assert.rejects(() => useCase.execute('ftp://example.com/video.mp4'), {
      name: 'BadRequestException',
    });
    await assert.rejects(() => useCase.execute('http://127.0.0.1:8080/internal'), {
      name: 'BadRequestException',
    });
    await assert.rejects(() => useCase.execute('http://169.254.169.254/latest/meta-data'), {
      name: 'BadRequestException',
    });
  });

  it('GetMediaInfoUseCase caches metadata on second request', async () => {
    let calls = 0;
    const mockWorker = {
      fetchMediaInfo: async (url) => {
        calls += 1;
        return { title: 'Sample Video', duration: 42, webpage_url: url };
      },
    };
    const useCase = new GetMediaInfoUseCase(mockWorker);

    const first = await useCase.execute('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(first.cached, false);
    assert.equal(calls, 1);

    const second = await useCase.execute('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
  });

  it('StartDownloadUseCase validates format & quality and creates queued task', async () => {
    const repo = new InMemoryTaskRepository();
    const createTaskUseCase = new CreateTaskUseCase(repo);
    const updateTaskUseCase = new UpdateTaskProgressUseCase(repo);
    const mockWorker = {
      triggerDownload: async () => undefined,
    };
    const useCase = new StartDownloadUseCase(mockWorker, createTaskUseCase, updateTaskUseCase);

    await assert.rejects(
      () => useCase.execute({ url: 'https://example.com/video', format: 'exe', quality: 'best' }),
      { name: 'BadRequestException' },
    );

    const res = await useCase.execute({
      url: 'https://example.com/video-unique-' + Date.now(),
      format: 'mp4',
      quality: '720',
    });
    assert.ok(res.job_id);
    assert.equal(res.cached, false);

    const saved = await repo.findById(new TaskId(res.job_id));
    assert.ok(saved);
    assert.equal(saved.status, TaskStatus.QUEUED);
  });

  it('UpdateTaskProgressUseCase updates task status and emits SSE event', async () => {
    const repo = new InMemoryTaskRepository();
    const createTaskUseCase = new CreateTaskUseCase(repo);
    const updateUseCase = new UpdateTaskProgressUseCase(repo);
    const mockWorker = { triggerDownload: async () => undefined };
    const startUseCase = new StartDownloadUseCase(mockWorker, createTaskUseCase, updateUseCase);

    const { job_id } = await startUseCase.execute({
      url: 'https://example.com/video-sse-' + Date.now(),
      format: 'mp3',
      quality: 'best',
    });

    await updateUseCase.execute({
      id: job_id,
      status: TaskStatus.COMPLETED,
      percent: 100,
      filename: 'song.mp3',
      downloadUrl: '/api/file/song.mp3',
    });

    const updated = await repo.findById(new TaskId(job_id));
    assert.equal(updated.status, TaskStatus.COMPLETED);
    assert.equal(updated.percent, 100);
    assert.equal(updated.filename, 'song.mp3');
  });
});
