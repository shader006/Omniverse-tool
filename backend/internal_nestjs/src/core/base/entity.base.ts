/**
 * Base Entity theo mẫu domain-driven-hexagon
 * Sở hữu danh tính duy nhất (Identity) và theo dõi thời gian tạo/cập nhật
 */
export abstract class Entity<TId> {
  protected readonly _id: TId;
  protected readonly _createdAt: Date;
  protected _updatedAt: Date;

  constructor(id: TId, createdAt?: Date, updatedAt?: Date) {
    this._id = id;
    this._createdAt = createdAt || new Date();
    this._updatedAt = updatedAt || new Date();
  }

  get id(): TId {
    return this._id;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  public equals(object?: Entity<TId>): boolean {
    if (object == null || object === undefined) {
      return false;
    }
    if (this === object) {
      return true;
    }
    return JSON.stringify(this._id) === JSON.stringify(object._id);
  }
}
