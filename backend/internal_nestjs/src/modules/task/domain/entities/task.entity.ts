import { AggregateRoot } from '../../../../core/base/aggregate-root.base';
import { TaskId } from '../value-objects/task-id.vo';
import { TaskStatus } from '../value-objects/task-status.enum';
import { TaskCannotCancelException } from '../exceptions/task.exceptions';

export interface CreateTaskProps {
  id?: TaskId;
  url?: string;
  format?: string;
  quality?: string;
  status?: TaskStatus;
  percent?: number;
  speed?: string;
  eta?: string;
  filename?: string;
  downloadUrl?: string;
  error?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Task Aggregate Root theo chuẩn Domain-Driven Design
 * Quản lý trạng thái và tiến độ của tác vụ đang chạy
 */
export class TaskEntity extends AggregateRoot<TaskId> {
  private _url: string;
  private _format: string;
  private _quality: string;
  private _status: TaskStatus;
  private _percent: number;
  private _speed: string;
  private _eta: string;
  private _filename?: string;
  private _downloadUrl?: string;
  private _error?: string;

  constructor(props: CreateTaskProps) {
    const id = props.id || new TaskId();
    super(id, props.createdAt, props.updatedAt);

    this._url = props.url || '';
    this._format = props.format || 'mp4';
    this._quality = props.quality || '1080p';
    this._status = props.status || TaskStatus.QUEUED;
    this._percent = props.percent ?? 0;
    this._speed = props.speed || '0 KiB/s';
    this._eta = props.eta || '--:--';
    this._filename = props.filename;
    this._downloadUrl = props.downloadUrl;
    this._error = props.error;
  }

  get url(): string {
    return this._url;
  }

  get format(): string {
    return this._format;
  }

  get quality(): string {
    return this._quality;
  }

  get status(): TaskStatus {
    return this._status;
  }

  get percent(): number {
    return this._percent;
  }

  get speed(): string {
    return this._speed;
  }

  get eta(): string {
    return this._eta;
  }

  get filename(): string | undefined {
    return this._filename;
  }

  get downloadUrl(): string | undefined {
    return this._downloadUrl;
  }

  get error(): string | undefined {
    return this._error;
  }

  isFinished(): boolean {
    return [TaskStatus.COMPLETED, TaskStatus.ERROR, TaskStatus.CANCELLED].includes(
      this._status,
    );
  }

  canCancel(): boolean {
    return !this.isFinished();
  }

  cancel(): void {
    if (!this.canCancel()) {
      throw new TaskCannotCancelException(this._status);
    }
    this._status = TaskStatus.CANCELLED;
    this._error = 'Tác vụ đã bị huỷ bởi người dùng';
    this._updatedAt = new Date();
  }

  markCompleted(filename: string, downloadUrl?: string): void {
    this._status = TaskStatus.COMPLETED;
    this._percent = 100;
    this._filename = filename;
    this._downloadUrl = downloadUrl;
    this._error = undefined;
    this._updatedAt = new Date();
  }

  markError(errMsg: string): void {
    this._status = TaskStatus.ERROR;
    this._error = errMsg;
    this._updatedAt = new Date();
  }

  updateProgress(percent: number, speed?: string, eta?: string): void {
    this._percent = Math.min(100, Math.max(0, percent));
    if (speed !== undefined) this._speed = speed;
    if (eta !== undefined) this._eta = eta;
    this._updatedAt = new Date();
  }

  updateStatus(status: TaskStatus): void {
    this._status = status;
    this._updatedAt = new Date();
  }
}
