import { Entity } from './entity.base';

/**
 * Base AggregateRoot kế thừa Entity và đóng gói toàn bộ quy tắc nghiệp vụ (Invariants)
 */
export abstract class AggregateRoot<TId> extends Entity<TId> {}
