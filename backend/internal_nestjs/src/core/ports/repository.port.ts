/**
 * Generic Repository Port định nghĩa hợp đồng thao tác dữ liệu chuẩn
 */
export interface RepositoryPort<TEntity, TId> {
  save(entity: TEntity): Promise<void>;
  findById(id: TId): Promise<TEntity | null>;
  findAll(): Promise<TEntity[]>;
  delete(id: TId): Promise<boolean>;
}
